<?php

namespace dokuwiki\Extension {
    class ActionPlugin
    {
        public $settings = [];

        public function getConf($name)
        {
            return $this->settings[$name] ?? '';
        }

        public function getLang($name)
        {
            return $name;
        }
    }

    class EventHandler
    {
    }

    class Event
    {
        public $data = ['meta' => [], 'script' => []];
    }
}

namespace dokuwiki\Search {
    class Indexer
    {
        public function getAllPages()
        {
            return $GLOBALS['TEST_PAGES'] ?? [];
        }
    }
}

namespace dokuwiki\HTTP {
    class DokuHTTPClient
    {
        public static $requests = [];
        public $timeout;
        public $headers = [];

        public function post($url, $body)
        {
            self::$requests[] = [$url, $body, $this->headers, $this->timeout];
            return 'OK';
        }
    }
}

namespace {
    define('AUTH_READ', 1);
    define('DOKU_CHANGE_TYPE_CREATE', 'C');
    define('DOKU_CHANGE_TYPE_EDIT', 'E');
    define('DOKU_CHANGE_TYPE_MINOR_EDIT', 'e');
    define('DOKU_CHANGE_TYPE_REVERT', 'R');
    define('DOKU_CHANGE_TYPE_DELETE', 'D');
    define('DOKU_URL', 'https://wiki.example/');

    function cleanID($id) { return $id; }
    function isHiddenPage($id) { return strpos($id, 'hidden') !== false; }
    function auth_aclcheck($id, $user = '', $groups = []) { return strpos($id, 'private') !== false ? 0 : AUTH_READ; }
    function p_read_metadata($id) { return $GLOBALS['TEST_META'][$id] ?? []; }
    function p_get_metadata($id, $key) { return $GLOBALS['TEST_TITLES'][$id] ?? ''; }
    function noNS($id) { return substr($id, strrpos($id, ':') === false ? 0 : strrpos($id, ':') + 1); }
    function wl($id = '', $params = [], $absolute = false, $separator = '&') {
        if (isset($params['do']) && $params['do'] === 'googleconsentindexnowkey') {
            return DOKU_URL . '?do=googleconsentindexnowkey';
        }
        return DOKU_URL . $id;
    }

    require dirname(__DIR__) . '/action.php';

    $plugin = new action_plugin_googleconsentmananger();
    $plugin->settings = [
        'consentMode' => 'invalid',
        'GTMID' => 'javascript:alert(1)',
        'GA4ID' => 'G-VALID123',
        'adsenseID' => 'ca-pub-1234567890123456',
        'expireDays' => '-5',
        'acceptOnScroll' => '1',
        'policyURL' => 'javascript:alert(1)',
        'googleVerification' => 'safe_token-123',
        'bingVerification' => '<script>',
        'yandexVerification' => '',
        'pinterestVerification' => 'pin123',
    ];

    $GLOBALS['conf'] = ['template' => 'default'];
    $GLOBALS['JSINFO'] = [];
    $plugin->handleDokuwikiStarted(new \dokuwiki\Extension\Event(), null);
    $config = $GLOBALS['JSINFO']['plugins']['googleconsent'];
    $check = function ($condition, $description) {
        if (!$condition) throw new \RuntimeException('Action configuration test failed: ' . $description);
    };
    $check($config['consentMode'] === 'strict', 'invalid modes fall back to strict');
    $check($config['GTMID'] === '', 'invalid GTM IDs are omitted');
    $check($config['GA4ID'] === 'G-VALID123', 'valid GA4 IDs are retained');
    $check($config['adsenseID'] === 'ca-pub-1234567890123456', 'valid publisher IDs are retained');
    $check($config['expireDays'] === 1, 'cookie lifetime has a lower bound');
    $check($config['acceptOnScroll'] === 1000, 'legacy scroll value has a safe threshold');
    $check($config['policyURL'] === '', 'unsafe policy URLs are omitted');

    $event = new \dokuwiki\Extension\Event();
    $plugin->handleTplMetaheaderOutput($event, null);
    $check(count($event->data['meta']) === 2, 'only valid verification tokens create meta tags');
    $check($event->data['meta'][0] === [
        'name' => 'google-site-verification',
        'content' => 'safe_token-123',
    ], 'Google verification token uses the expected meta format');
    $check(strpos($event->data['script'][0]['_data'], "'analytics_storage':'denied'") !== false,
        'consent defaults are emitted before configured tags');

    $verificationOnly = new action_plugin_googleconsentmananger();
    $verificationOnly->settings = ['googleVerification' => 'token123'];
    $verificationEvent = new \dokuwiki\Extension\Event();
    $verificationOnly->handleTplMetaheaderOutput($verificationEvent, null);
    $check($verificationEvent->data['script'] === [],
        'verification-only setup does not emit unused tracking JavaScript');

    $news = new action_plugin_googleconsentmananger();
    $news->settings = [
        'newsPublicationName' => 'Example News & Reports',
        'newsLanguage' => 'en',
        'newsNamespace' => 'news',
    ];
    $now = time();
    $GLOBALS['TEST_PAGES'] = [
        'news:recent',
        'news:old',
        'news:hidden-page',
        'news:private-page',
        'other:recent',
    ];
    $GLOBALS['TEST_META'] = [
        'news:recent' => ['persistent' => ['date' => ['created' => $now - 3600]]],
        'news:old' => ['persistent' => ['date' => ['created' => $now - 200000]]],
        'news:hidden-page' => ['persistent' => ['date' => ['created' => $now - 1800]]],
        'news:private-page' => ['persistent' => ['date' => ['created' => $now - 1800]]],
        'other:recent' => ['persistent' => ['date' => ['created' => $now - 1800]]],
    ];
    $GLOBALS['TEST_TITLES'] = ['news:recent' => 'New & Improved <News>'];
    $xml = $news->generateNewsSitemap();
    $check(substr_count($xml, '<url>') === 1, 'News sitemap includes only recent public visible pages in namespace');
    $check(strpos($xml, 'Example News &amp; Reports') !== false, 'publication name is XML escaped');
    $check(strpos($xml, 'New &amp; Improved &lt;News&gt;') !== false, 'article title is XML escaped');
    $check(strpos($xml, 'news:old') === false, 'articles older than 48 hours are omitted');

    $indexNow = new action_plugin_googleconsentmananger();
    $indexNow->settings = ['indexNowKey' => 'valid-key-123'];
    $saveEvent = new \dokuwiki\Extension\Event();
    $saveEvent->data = ['id' => 'news:recent', 'changeType' => DOKU_CHANGE_TYPE_EDIT];
    \dokuwiki\HTTP\DokuHTTPClient::$requests = [];
    $indexNow->handleWikiPageSave($saveEvent, null);
    $check(count(\dokuwiki\HTTP\DokuHTTPClient::$requests) === 1, 'public page save submits one IndexNow notification');
    [$endpoint, $payload, $headers, $timeout] = \dokuwiki\HTTP\DokuHTTPClient::$requests[0];
    $json = json_decode($payload, true);
    $check($endpoint === 'https://api.indexnow.org/indexnow', 'IndexNow uses the official submission endpoint');
    $check($json['key'] === 'valid-key-123' && $json['host'] === 'wiki.example',
        'IndexNow payload uses configured key and canonical host');
    $check($json['keyLocation'] === 'https://wiki.example/?do=googleconsentindexnowkey',
        'IndexNow payload identifies the plugin key verification endpoint');

    $invalidKeyPlugin = new action_plugin_googleconsentmananger();
    $invalidKeyPlugin->settings = ['indexNowKey' => '<invalid>'];
    \dokuwiki\HTTP\DokuHTTPClient::$requests = [];
    $invalidKeyPlugin->handleWikiPageSave($saveEvent, null);
    $check(\dokuwiki\HTTP\DokuHTTPClient::$requests === [], 'invalid IndexNow keys disable submissions');
    \dokuwiki\HTTP\DokuHTTPClient::$requests = [];
    $privateSave = new \dokuwiki\Extension\Event();
    $privateSave->data = ['id' => 'news:private-page', 'changeType' => DOKU_CHANGE_TYPE_EDIT];
    $indexNow->handleWikiPageSave($privateSave, null);
    $check(\dokuwiki\HTTP\DokuHTTPClient::$requests === [], 'restricted pages are not sent to IndexNow');
    $minorSave = new \dokuwiki\Extension\Event();
    $minorSave->data = ['id' => 'news:recent', 'changeType' => DOKU_CHANGE_TYPE_MINOR_EDIT];
    $indexNow->handleWikiPageSave($minorSave, null);
    $check(\dokuwiki\HTTP\DokuHTTPClient::$requests === [], 'minor edits are not sent to IndexNow');

    echo "Action configuration tests passed\n";
}
