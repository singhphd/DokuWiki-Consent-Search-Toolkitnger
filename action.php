<?php

use dokuwiki\Extension\ActionPlugin;
use dokuwiki\Extension\EventHandler;
use dokuwiki\Extension\Event;
use dokuwiki\HTTP\DokuHTTPClient;
use dokuwiki\Search\Indexer;

/**
 * DokuWiki Plugin googleconsentmananger (Action Component)
 *
 * @license GPL 2 http://www.gnu.org/licenses/gpl-2.0.html
 * @author i-net /// software <tools@inetsoftware.de>
 */
class action_plugin_googleconsentmananger extends ActionPlugin
{
    const GTM_PATTERN = '/^GTM-[A-Z0-9]+$/';
    const GA4_PATTERN = '/^G-[A-Z0-9]+$/';
    const ADSENSE_PATTERN = '/^ca-pub-[0-9]{16}$/';

    public function register(EventHandler $controller)
    {
        $controller->register_hook('TPL_METAHEADER_OUTPUT', 'BEFORE', $this, 'handleTplMetaheaderOutput');
        $controller->register_hook('DOKUWIKI_STARTED', 'AFTER', $this, 'handleDokuwikiStarted');
        $controller->register_hook('COMMON_WIKIPAGE_SAVE', 'AFTER', $this, 'handleWikiPageSave');
        $controller->register_hook('ACTION_ACT_PREPROCESS', 'BEFORE', $this, 'handleCustomAction');
    }

    public function handleDokuwikiStarted(Event $event, $param)
    {
        global $JSINFO, $conf;

        $mode = $this->getConf('consentMode');
        $scrollThreshold = max(0, min(100000, (int)$this->getConf('acceptOnScroll')));
        if ($scrollThreshold === 1) $scrollThreshold = 1000;
        $JSINFO['plugins']['googleconsent'] = [
            'template' => $conf['template'],
            'consentCookieName' => 'googleconsentmananger-consent',
            'consentMode' => in_array($mode, ['strict', 'consent'], true) ? $mode : 'strict',
            'GTMID' => $this->getGTMID(),
            'GA4ID' => $this->getGA4ID(),
            'adsenseID' => $this->getAdsenseID(),
            'acceptBody' => (string)$this->getConf('acceptBody'),
            'policyURL' => $this->validPolicyUrl($this->getConf('policyURL')),
            'expireDays' => max(1, min(3650, (int)$this->getConf('expireDays'))),
            'acceptOnContinue' => (bool)$this->getConf('acceptOnContinue'),
            'acceptOnScroll' => $scrollThreshold,
            'acceptAnyClick' => (bool)$this->getConf('acceptAnyClick'),
        ];
        foreach (['acceptAll', 'rejectAll', 'managePreferences', 'savePreferences',
                     'analyticsLabel', 'advertisingLabel', 'necessaryLabel', 'preferencesTitle',
                     'preferencesDescription', 'openPreferences', 'policyLabel'] as $key) {
            $JSINFO['plugins']['googleconsent'][$key] = (string)$this->getLang($key);
        }
    }

    public function handleTplMetaheaderOutput(Event $event, $param)
    {
        $verification = [
            'googleVerification' => 'google-site-verification',
            'bingVerification' => 'msvalidate.01',
            'yandexVerification' => 'yandex-verification',
            'pinterestVerification' => 'p:domain_verify',
        ];
        foreach ($verification as $setting => $name) {
            $value = (string)$this->getConf($setting);
            if ($value !== '' && strlen($value) <= 255 && preg_match('/^[A-Za-z0-9_-]+$/', $value)) {
                $event->data['meta'][] = ['name' => $name, 'content' => $value];
            }
        }

        $hasTrackingIntegration = $this->getGTMID() !== '' ||
            $this->getGA4ID() !== '' || $this->getAdsenseID() !== '';
        if ($hasTrackingIntegration) {
            $event->data['script'][] = [
                'type' => 'text/javascript',
                '_data' => "window.dataLayer = window.dataLayer || [];\n" .
                    "window.gtag = window.gtag || function(){window.dataLayer.push(arguments);};\n" .
                    "window.gtag('consent', 'default', {" .
                    "'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied'," .
                    "'analytics_storage':'denied','functionality_storage':'granted'," .
                    "'personalization_storage':'denied','security_storage':'granted'});",
            ];
        }
    }

    public function handleCustomAction(Event $event, $param)
    {
        if ($event->data === 'googleconsentnews') {
            header('Content-Type: application/xml; charset=utf-8');
            header('Cache-Control: public, max-age=300');
            echo $this->generateNewsSitemap();
            exit;
        }

        if ($event->data === 'googleconsentindexnowkey') {
            $key = $this->getIndexNowKey();
            if ($key === '') {
                http_status(404);
                exit;
            }
            header('Content-Type: text/plain; charset=utf-8');
            header('Cache-Control: public, max-age=3600');
            echo $key;
            exit;
        }
    }

    public function handleWikiPageSave(Event $event, $param)
    {
        $key = $this->getIndexNowKey();
        if ($key === '' || empty($event->data['id'])) return;
        if (!in_array($event->data['changeType'] ?? '', [
            DOKU_CHANGE_TYPE_CREATE,
            DOKU_CHANGE_TYPE_EDIT,
            DOKU_CHANGE_TYPE_REVERT,
            DOKU_CHANGE_TYPE_DELETE,
        ], true)) return;

        $id = cleanID($event->data['id']);
        if (!$id || isHiddenPage($id)) return;
        if (($event->data['changeType'] ?? '') !== DOKU_CHANGE_TYPE_DELETE &&
            auth_aclcheck($id, '', []) < AUTH_READ) return;

        $url = wl($id, '', true, '&');
        $site = parse_url(DOKU_URL);
        if (!$site || empty($site['host']) || parse_url($url, PHP_URL_HOST) !== $site['host']) return;

        $keyLocation = wl('', ['do' => 'googleconsentindexnowkey'], true, '&');
        $body = json_encode([
            'host' => $site['host'],
            'key' => $key,
            'keyLocation' => $keyLocation,
            'urlList' => [$url],
        ]);
        if ($body === false) return;

        $http = new DokuHTTPClient();
        $http->timeout = 5;
        $http->headers['Content-Type'] = 'application/json; charset=utf-8';
        try {
            $http->post('https://api.indexnow.org/indexnow', $body);
        } catch (\Throwable $e) {
            // Search notification failures must not interrupt the page save.
        }
    }

    public function generateNewsSitemap()
    {
        $publication = trim((string)$this->getConf('newsPublicationName'));
        $language = strtolower(trim((string)$this->getConf('newsLanguage')));
        $namespace = trim((string)$this->getConf('newsNamespace'), ':');
        if ($publication === '' || !preg_match('/^[a-z]{2}$/', $language) || $namespace === '') {
            return $this->formatNewsSitemap([]);
        }

        $pages = (new Indexer())->getAllPages();
        $entries = [];
        $now = time();
        $cutoff = $now - (2 * 86400);
        foreach ($pages as $id) {
            if ($id !== $namespace && strpos($id, $namespace . ':') !== 0) continue;
            if (isHiddenPage($id) || auth_aclcheck($id, '', []) < AUTH_READ) continue;

            $meta = p_read_metadata($id);
            $created = (int)($meta['persistent']['date']['created'] ?? 0);
            if ($created < $cutoff || $created > $now) continue;

            $title = trim((string)p_get_metadata($id, 'title'));
            if ($title === '') $title = noNS($id);
            $entries[] = [
                'url' => wl($id, '', true, '&'),
                'title' => $title,
                'published' => $created,
            ];
        }

        usort($entries, static function ($left, $right) {
            return $right['published'] <=> $left['published'];
        });
        return $this->formatNewsSitemap(array_slice($entries, 0, 1000), $publication, $language);
    }

    private function formatNewsSitemap(array $entries, $publication = '', $language = '')
    {
        $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
        $xml .= '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ';
        $xml .= 'xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">' . "\n";
        foreach ($entries as $entry) {
            $xml .= "  <url>\n";
            $xml .= '    <loc>' . $this->xmlEscape($entry['url']) . "</loc>\n";
            $xml .= "    <news:news>\n";
            $xml .= "      <news:publication>\n";
            $xml .= '        <news:name>' . $this->xmlEscape($publication) . "</news:name>\n";
            $xml .= '        <news:language>' . $this->xmlEscape($language) . "</news:language>\n";
            $xml .= "      </news:publication>\n";
            $xml .= '      <news:publication_date>' . gmdate('c', $entry['published']) .
                "</news:publication_date>\n";
            $xml .= '      <news:title>' . $this->xmlEscape($entry['title']) . "</news:title>\n";
            $xml .= "    </news:news>\n";
            $xml .= "  </url>\n";
        }
        return $xml . "</urlset>\n";
    }

    private function xmlEscape($value)
    {
        return htmlspecialchars((string)$value, ENT_XML1 | ENT_COMPAT, 'UTF-8');
    }

    private function getIndexNowKey()
    {
        $key = trim((string)$this->getConf('indexNowKey'));
        return strlen($key) >= 8 && strlen($key) <= 128 && preg_match('/^[A-Za-z0-9-]+$/', $key)
            ? $key
            : '';
    }

    private function validId($value, $pattern)
    {
        $value = (string)$value;
        return preg_match($pattern, $value) ? $value : '';
    }

    private function getGTMID()
    {
        return $this->validId($this->getConf('GTMID'), self::GTM_PATTERN);
    }

    private function getGA4ID()
    {
        return $this->validId($this->getConf('GA4ID'), self::GA4_PATTERN);
    }

    private function getAdsenseID()
    {
        return $this->validId($this->getConf('adsenseID'), self::ADSENSE_PATTERN);
    }

    private function validPolicyUrl($value)
    {
        $value = trim((string)$value);
        if ($value === '') return '';
        if (strpos($value, '/') === 0 && strpos($value, '//') !== 0) return $value;
        $url = parse_url($value);
        return $url && isset($url['scheme'], $url['host']) &&
            in_array(strtolower($url['scheme']), ['http', 'https'], true) ? $value : '';
    }
}
