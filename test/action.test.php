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

namespace {
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

    echo "Action configuration tests passed\n";
}
