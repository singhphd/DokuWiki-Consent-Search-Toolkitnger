<?php

/**
 * Options for the googleconsentmananger plugin
 *
 * @author i-net /// software <tools@inetsoftware.de>
 */

$meta['consentMode'] = array('multichoice', '_choices' => array('strict', 'consent'));
$meta['GTMID'] = array('string');
$meta['GA4ID'] = array('string');
$meta['adsenseID'] = array('string');
$meta['googleVerification'] = array('string');
$meta['bingVerification'] = array('string');
$meta['yandexVerification'] = array('string');
$meta['pinterestVerification'] = array('string');
$meta['newsPublicationName'] = array('string');
$meta['newsLanguage'] = array('string');
$meta['newsNamespace'] = array('string');
$meta['indexNowKey'] = array('string');
$meta['acceptBody'] = array('string');
$meta['policyURL'] = array('string');
$meta['expireDays'] = array('numeric', '_min' => 1, '_max' => 3650);
$meta['acceptOnContinue'] = array('onoff');
$meta['acceptOnScroll'] = array('numeric', '_min' => 0, '_max' => 100000);
$meta['acceptAnyClick'] = array('onoff');
