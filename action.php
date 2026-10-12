<?php

use dokuwiki\Extension\ActionPlugin;
use dokuwiki\Extension\EventHandler;
use dokuwiki\Extension\Event;

/**
 * DokuWiki Plugin googleconsentmananger (Action Component)
 *
 * @license GPL 2 http://www.gnu.org/licenses/gpl-2.0.html
 * @author i-net /// software <tools@inetsoftware.de>
 */
class action_plugin_googleconsentmananger extends ActionPlugin
{
    public function register(EventHandler $controller)
    {
        $controller->register_hook('TPL_METAHEADER_OUTPUT', 'BEFORE', $this, 'handleTplMetaheaderOutput');
        $controller->register_hook('DOKUWIKI_STARTED', 'AFTER', $this, 'handleDokuwikiStarted');
    }

    public function handleDokuwikiStarted(Event $event, $param)
    {
        global $JSINFO, $conf;

        $mode = $this->getConf('consentMode');
        $JSINFO['plugins']['googleconsent'] = [
            'template' => $conf['template'],
            'consentMode' => in_array($mode, ['strict', 'consent'], true) ? $mode : 'strict',
            'GTMID' => $this->validId($this->getConf('GTMID'), '/^GTM-[A-Z0-9]+$/'),
            'GA4ID' => $this->validId($this->getConf('GA4ID'), '/^G-[A-Z0-9]+$/'),
            'adsenseID' => $this->validId($this->getConf('adsenseID'), '/^ca-pub-[0-9]{16}$/'),
            'acceptBody' => (string)$this->getConf('acceptBody'),
            'policyURL' => $this->validPolicyUrl($this->getConf('policyURL')),
            'expireDays' => max(1, min(3650, (int)$this->getConf('expireDays'))),
            'acceptOnContinue' => (bool)$this->getConf('acceptOnContinue'),
            'acceptOnScroll' => max(0, (int)$this->getConf('acceptOnScroll')),
            'acceptAnyClick' => (bool)$this->getConf('acceptAnyClick'),
        ];
        foreach (['acceptAll', 'rejectAll', 'managePreferences', 'savePreferences',
                     'analyticsLabel', 'advertisingLabel', 'necessaryLabel', 'preferencesTitle',
                     'preferencesDescription', 'openPreferences'] as $key) {
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

    private function validId($value, $pattern)
    {
        $value = (string)$value;
        return preg_match($pattern, $value) ? $value : '';
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
