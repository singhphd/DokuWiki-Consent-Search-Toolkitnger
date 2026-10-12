const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

class Element {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.listeners = {};
        this.attributes = {};
        this.hidden = false;
        this.checked = false;
        this.disabled = false;
        this.className = '';
        this.textContent = '';
    }

    appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        return child;
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    addEventListener(name, callback) {
        this.listeners[name] = callback;
    }

    click() {
        if (this.listeners.click) this.listeners.click({ target: this });
    }

    focus() {
        this.focused = true;
    }

    contains(target) {
        return this === target || this.children.some(child => child.contains(target));
    }

    querySelector(selector) {
        if (selector !== 'input:not(:disabled)') throw new Error(`Unexpected selector: ${selector}`);
        return find(this, item => item.tagName === 'INPUT' && !item.disabled);
    }
}

function find(element, predicate) {
    if (predicate(element)) return element;
    for (const child of element.children) {
        const result = find(child, predicate);
        if (result) return result;
    }
    return null;
}

function runPlugin({ mode = 'strict', cookies = '', acceptOnScroll = 0, overrides = {} } = {}) {
    const cookieJar = new Map(cookies.split(';').filter(Boolean).map(item => {
        const [name, ...value] = item.trim().split('=');
        return [name, value.join('=')];
    }));
    const head = new Element('head');
    const body = new Element('body');
    const document = {
        head,
        body,
        referrer: '',
        createElement: tag => new Element(tag),
        createTextNode: text => ({ textContent: text, children: [], contains: () => false }),
        getElementById(id) {
            return find({ children: [head, body] }, item => item.id === id);
        },
        addEventListener() {},
        removeEventListener() {}
    };
    Object.defineProperty(document, 'cookie', {
        get: () => Array.from(cookieJar, ([name, value]) => `${name}=${value}`).join('; '),
        set: value => {
            const [pair] = value.split(';');
            const separator = pair.indexOf('=');
            cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
    });
    const window = {
        location: { protocol: 'https:', origin: 'https://wiki.example' },
        dataLayer: [],
        addEventListener() {},
        removeEventListener() {}
    };
    window.gtag = (...args) => window.dataLayer.push(args);
    const config = Object.assign({
        template: 'default',
        consentMode: mode,
        GTMID: 'GTM-ABC123',
        GA4ID: 'G-ABC123',
        adsenseID: 'ca-pub-1234567890123456',
        expireDays: 30,
        acceptOnContinue: false,
        acceptOnScroll,
        acceptAnyClick: false,
        acceptBody: 'Optional tracking',
        policyURL: '',
        acceptAll: 'Accept all',
        rejectAll: 'Reject optional',
        managePreferences: 'Manage preferences',
        savePreferences: 'Save preferences',
        analyticsLabel: 'Analytics',
        advertisingLabel: 'Advertising',
        necessaryLabel: 'Necessary',
        preferencesTitle: 'Privacy preferences',
        preferencesDescription: 'Choose your preferences.',
        openPreferences: 'Cookie preferences',
        policyLabel: 'Privacy policy'
    }, overrides);
    const context = {
        document,
        window,
        JSINFO: { ACT: 'show', plugins: { googleconsent: config } },
        LANG: { template: {} },
        jQuery: callback => callback(),
        URL,
        Date,
        JSON,
        Math,
        encodeURIComponent
    };
    vm.runInNewContext(source, context);
    const button = className => find(body, item =>
        item.tagName === 'BUTTON' && item.className === className);
    const externalScripts = () => head.children.filter(item => item.src);
    return { body, button, document, externalScripts };
}

test('strict opt-in does not load tags until a category is accepted', () => {
    const plugin = runPlugin({ cookies: 'dokuwiki_session=keep' });
    assert.equal(plugin.externalScripts().length, 0);

    plugin.button('googleconsent-manage').click();
    const analytics = find(plugin.body, item => item.id === 'googleconsent-analytics');
    analytics.checked = true;
    plugin.button('googleconsent-save').click();

    assert.deepEqual(plugin.externalScripts().map(script => script.src), [
        'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'
    ]);
    const cookies = plugin.document.cookie;
    assert.match(cookies, /dokuwiki_session=keep/);
    assert.match(cookies, /googleconsentmananger-consent=/);
});

test('rejecting optional categories does not load tags or clear unrelated cookies', () => {
    const plugin = runPlugin({ cookies: 'dokuwiki_session=keep; other_site=value' });
    plugin.button('googleconsent-reject').click();

    assert.equal(plugin.externalScripts().length, 0);
    assert.match(plugin.document.cookie, /dokuwiki_session=keep/);
    assert.match(plugin.document.cookie, /other_site=value/);
    const choice = JSON.parse(decodeURIComponent(
        plugin.document.cookie.match(/googleconsentmananger-consent=([^;]+)/)[1]
    ));
    assert.deepEqual(choice, { analytics: false, advertising: false });
});

test('Consent Mode loads GTM with denied defaults before a preference is saved', () => {
    const plugin = runPlugin({ mode: 'consent' });
    assert.deepEqual(plugin.externalScripts().map(script => script.src), [
        'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'
    ]);
    assert.equal(plugin.document.cookie.includes('googleconsentmananger-consent='), false);
});

test('standalone GA4 and Auto Ads load only for their separate consent categories', () => {
    const plugin = runPlugin({
        overrides: { GTMID: '', GA4ID: 'G-ABC123', adsenseID: 'ca-pub-1234567890123456' }
    });
    plugin.button('googleconsent-manage').click();
    find(plugin.body, item => item.id === 'googleconsent-analytics').checked = true;
    plugin.button('googleconsent-save').click();

    assert.deepEqual(plugin.externalScripts().map(script => script.src), [
        'https://www.googletagmanager.com/gtag/js?id=G-ABC123'
    ]);
});
