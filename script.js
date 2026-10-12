jQuery(function () {
    var config = JSINFO.plugins.googleconsent;
    if (!config || JSINFO.ACT !== 'show') return;

    // Preserve the repository's existing plugin spelling in the cookie name.
    var cookieName = 'googleconsentmananger-consent';
    var options = config;
    var savedConsent = readConsent();
    var labels = {
        acceptAll: 'Accept all',
        rejectAll: 'Reject optional',
        managePreferences: 'Manage preferences',
        savePreferences: 'Save preferences',
        analyticsLabel: 'Analytics',
        advertisingLabel: 'Advertising',
        necessaryLabel: 'Strictly necessary (always active)',
        preferencesTitle: 'Privacy preferences',
        preferencesDescription: 'Choose which optional categories you allow. You can change your choice at any time.',
        openPreferences: 'Cookie preferences',
        policyLabel: 'Privacy policy'
    };

    function label(key) {
        var template = LANG.template && LANG.template[options.template];
        return (template && template[key]) || options[key] || labels[key];
    }

    function readConsent() {
        var entry = document.cookie.split(';').map(function (item) {
            return item.trim();
        }).filter(function (item) {
            return item.indexOf(cookieName + '=') === 0;
        })[0];
        if (!entry) return null;
        try {
            var choice = JSON.parse(decodeURIComponent(entry.substring(cookieName.length + 1)));
            if (choice && typeof choice.analytics === 'boolean' &&
                typeof choice.advertising === 'boolean') return choice;
        } catch (error) {
            return null;
        }
        return null;
    }

    function storeConsent(choice) {
        var expires = new Date();
        expires.setTime(expires.getTime() + (options.expireDays * 86400000));
        document.cookie = cookieName + '=' + encodeURIComponent(JSON.stringify(choice)) +
            '; expires=' + expires.toUTCString() + '; path=/; SameSite=Lax' +
            (window.location.protocol === 'https:' ? '; Secure' : '');
        savedConsent = choice;
    }

    function updateGoogleConsent(choice) {
        if (typeof window.gtag !== 'function') return;
        window.gtag('consent', 'update', {
            analytics_storage: choice.analytics ? 'granted' : 'denied',
            ad_storage: choice.advertising ? 'granted' : 'denied',
            ad_user_data: choice.advertising ? 'granted' : 'denied',
            ad_personalization: choice.advertising ? 'granted' : 'denied',
            functionality_storage: 'granted',
            personalization_storage: 'denied',
            security_storage: 'granted'
        });
    }

    function loadGTM() {
        if (!options.GTMID || document.getElementById('googleconsent-gtm')) return;
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
        var script = document.createElement('script');
        script.id = 'googleconsent-gtm';
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(options.GTMID);
        document.head.appendChild(script);
    }

    function loadGA4() {
        if (!options.GA4ID || options.GTMID || document.getElementById('googleconsent-ga4')) return;
        window.dataLayer = window.dataLayer || [];
        window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
        var script = document.createElement('script');
        script.id = 'googleconsent-ga4';
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(options.GA4ID);
        document.head.appendChild(script);
        window.gtag('js', new Date());
        window.gtag('config', options.GA4ID);
    }

    function loadAdSense() {
        if (!options.adsenseID || document.getElementById('googleconsent-adsense')) return;
        var script = document.createElement('script');
        script.id = 'googleconsent-adsense';
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' +
            encodeURIComponent(options.adsenseID);
        document.head.appendChild(script);
    }

    function loadConsentedIntegrations(choice) {
        updateGoogleConsent(choice);
        if (options.consentMode === 'consent') loadGTM();
        else if (choice.analytics || choice.advertising) loadGTM();
        if (choice.analytics) {
            if (!options.GTMID) loadGA4();
        }
        if (choice.advertising) {
            loadAdSense();
        }
    }

    function element(tag, className, text) {
        var result = document.createElement(tag);
        if (className) result.className = className;
        if (text) result.textContent = text;
        return result;
    }

    function createButton(text, className, callback) {
        var button = element('button', className, text);
        button.type = 'button';
        button.addEventListener('click', callback);
        return button;
    }

    function saveAndClose(choice) {
        storeConsent(choice);
        loadConsentedIntegrations(choice);
        banner.hidden = true;
        preferences.hidden = true;
        opener.hidden = false;
    }

    function createCategoryRow(parent, id, text, checked, disabled) {
        var row = element('label', 'googleconsent-category');
        var checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.id = id;
        checkbox.checked = checked;
        checkbox.disabled = !!disabled;
        row.appendChild(checkbox);
        row.appendChild(document.createTextNode(' ' + text));
        parent.appendChild(row);
        return checkbox;
    }

    var banner = element('section', 'googleconsent-banner');
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', label('preferencesTitle'));
    banner.hidden = !!savedConsent;

    var message = element('p', 'googleconsent-message',
        options.acceptBody || label('preferencesDescription'));
    banner.appendChild(message);
    if (options.policyURL) {
        var policy = element('a', 'googleconsent-policy', label('policyLabel'));
        policy.href = options.policyURL;
        policy.rel = 'noopener';
        banner.appendChild(policy);
    }
    var actions = element('div', 'googleconsent-actions');
    actions.appendChild(createButton(label('acceptAll'), 'googleconsent-accept', function () {
        saveAndClose({ analytics: true, advertising: true });
    }));
    actions.appendChild(createButton(label('rejectAll'), 'googleconsent-reject', function () {
        saveAndClose({ analytics: false, advertising: false });
    }));
    var manageButton = createButton(label('managePreferences'), 'googleconsent-manage', function () {
        preferences.hidden = false;
        preferences.querySelector('input:not(:disabled)').focus();
    });
    actions.appendChild(manageButton);
    banner.appendChild(actions);

    var preferences = element('div', 'googleconsent-preferences');
    preferences.hidden = true;
    preferences.setAttribute('role', 'group');
    preferences.setAttribute('aria-labelledby', 'googleconsent-title');
    preferences.appendChild(element('h2', '', label('preferencesTitle'))).id = 'googleconsent-title';
    preferences.appendChild(element('p', '', label('preferencesDescription')));
    createCategoryRow(preferences, 'googleconsent-necessary', label('necessaryLabel'), true, true);
    var analytics = createCategoryRow(preferences, 'googleconsent-analytics',
        label('analyticsLabel'), !!(savedConsent && savedConsent.analytics), false);
    var advertising = createCategoryRow(preferences, 'googleconsent-advertising',
        label('advertisingLabel'), !!(savedConsent && savedConsent.advertising), false);
    preferences.appendChild(createButton(label('savePreferences'), 'googleconsent-save', function () {
        saveAndClose({ analytics: analytics.checked, advertising: advertising.checked });
    }));
    preferences.appendChild(createButton(label('rejectAll'), 'googleconsent-reject', function () {
        saveAndClose({ analytics: false, advertising: false });
    }));
    banner.appendChild(preferences);

    var opener = createButton(label('openPreferences'), 'googleconsent-opener', function () {
        banner.hidden = false;
        preferences.hidden = false;
        preferences.querySelector('input:not(:disabled)').focus();
    });
    opener.hidden = !savedConsent;
    document.body.appendChild(banner);
    document.body.appendChild(opener);

    preferences.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            preferences.hidden = true;
            if (savedConsent) banner.hidden = true;
            (savedConsent ? opener : manageButton).focus();
        }
    });

    if (savedConsent) loadConsentedIntegrations(savedConsent);
    else if (options.consentMode === 'consent') loadGTM();

    function acceptAll() {
        saveAndClose({ analytics: true, advertising: true });
    }

    function isSameSiteReferrer() {
        if (!document.referrer) return false;
        try {
            return new URL(document.referrer).origin === window.location.origin;
        } catch (error) {
            return false;
        }
    }

    if (!savedConsent && options.acceptOnContinue && isSameSiteReferrer()) acceptAll();

    if (!savedConsent && options.acceptOnScroll > 0) {
        var initialScroll = window.scrollY;
        window.addEventListener('scroll', function onScroll() {
            if (Math.abs(window.scrollY - initialScroll) >= options.acceptOnScroll) {
                window.removeEventListener('scroll', onScroll);
                acceptAll();
            }
        }, { passive: true });
    }

    if (!savedConsent && options.acceptAnyClick) {
        document.addEventListener('click', function onClick(event) {
            if (!banner.contains(event.target) && event.target !== opener) {
                document.removeEventListener('click', onClick);
                acceptAll();
            }
        });
    }
});
