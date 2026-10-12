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
    $check = function ($condition) {
        if (!$condition) throw new \RuntimeException('Action configuration test failed');
    };
    $check($config['consentMode'] === 'strict');
    $check($config['GTMID'] === '');
    $check($config['GA4ID'] === 'G-VALID123');
    $check($config['adsenseID'] === 'ca-pub-1234567890123456');
    $check($config['expireDays'] === 1);
    $check($config['acceptOnScroll'] === 1000);
    $check($config['policyURL'] === '');

    $event = new \dokuwiki\Extension\Event();
    $plugin->handleTplMetaheaderOutput($event, null);
    $check(count($event->data['meta']) === 2);
    $check($event->data['meta'][0] === [
        'name' => 'google-site-verification',
        'content' => 'safe_token-123',
    ]);
    $check(strpos($event->data['script'][0]['_data'], "'analytics_storage':'denied'") !== false);

    echo "Action configuration tests passed\n";
}
