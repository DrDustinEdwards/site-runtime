export const FAMILY_DEVIATIONS: Readonly<{
    T2: "HSTS on the http:// to https:// hop: a browser ignores Strict-Transport-Security sent over plain http (RFC 6797 section 8.1), and on a custom domain that hop is Cloudflare's Always Use HTTPS, a zone setting no Worker answers. The https redirect hops are graded instead.";
    D3: "OpenPGP signing of security.txt: it needs a family signing key that Dustin holds and rotates, and none exists; RFC 9116 section 2.3 recommends a signature, it does not require one. A signed file is graded when one appears.";
    R4: "JSON routes refusing text/plain and form bodies (requireJson, ./body): the live check has no session, and every JSON route a stranger can reach answers 401 before it reads a body, so only the site's own code can show it.";
}>;
export const SITE_DEVIATIONS: Readonly<{
    "dustinedwards-info": {
        readonly C3: {
            readonly reason: "buildContentSecurityPolicy refuses strictDynamic beside cloudflareWebAnalytics: 'strict-dynamic' makes a browser ignore host sources, and the edge injects the Web Analytics beacon with no nonce, and with an integrity that changes at each Cloudflare release, so neither a nonce nor a hash can let it run.";
        };
    };
    foxhound: {
        readonly C3: {
            readonly reason: "buildContentSecurityPolicy refuses strictDynamic beside cloudflareWebAnalytics: 'strict-dynamic' makes a browser ignore host sources, and the edge injects the Web Analytics beacon with no nonce, and with an integrity that changes at each Cloudflare release, so neither a nonce nor a hash can let it run.";
        };
    };
    foxing: {
        readonly C3: {
            readonly reason: "buildContentSecurityPolicy refuses strictDynamic beside cloudflareWebAnalytics: 'strict-dynamic' makes a browser ignore host sources, and the edge injects the Web Analytics beacon with no nonce, and with an integrity that changes at each Cloudflare release, so neither a nonce nor a hash can let it run.";
        };
    };
    germomics: {
        readonly C3: {
            readonly reason: "buildContentSecurityPolicy refuses strictDynamic beside cloudflareWebAnalytics: 'strict-dynamic' makes a browser ignore host sources, and the edge injects the Web Analytics beacon with no nonce, and with an integrity that changes at each Cloudflare release, so neither a nonce nor a hash can let it run.";
        };
    };
    "julieedwards-info": {
        readonly C3: {
            readonly reason: "buildContentSecurityPolicy refuses strictDynamic beside cloudflareWebAnalytics: 'strict-dynamic' makes a browser ignore host sources, and the edge injects the Web Analytics beacon with no nonce, and with an integrity that changes at each Cloudflare release, so neither a nonce nor a hash can let it run.";
        };
    };
    bsw: {
        C3: {
            reason: string;
        };
    };
    txasm: {
        readonly C3: {
            readonly reason: "buildContentSecurityPolicy refuses strictDynamic beside cloudflareWebAnalytics: 'strict-dynamic' makes a browser ignore host sources, and the edge injects the Web Analytics beacon with no nonce, and with an integrity that changes at each Cloudflare release, so neither a nonce nor a hash can let it run.";
        };
    };
    carrel: {
        readonly C3: {
            readonly reason: "buildContentSecurityPolicy refuses strictDynamic beside cloudflareWebAnalytics: 'strict-dynamic' makes a browser ignore host sources, and the edge injects the Web Analytics beacon with no nonce, and with an integrity that changes at each Cloudflare release, so neither a nonce nor a hash can let it run.";
        };
    };
    "capsid-portal": {
        C3: {
            reason: string;
        };
    };
    capsid: {
        readonly C3: {
            readonly reason: "buildContentSecurityPolicy refuses strictDynamic beside cloudflareWebAnalytics: 'strict-dynamic' makes a browser ignore host sources, and the edge injects the Web Analytics beacon with no nonce, and with an integrity that changes at each Cloudflare release, so neither a nonce nor a hash can let it run.";
        };
    };
    enarratio: {
        readonly C3: {
            readonly reason: "buildContentSecurityPolicy refuses strictDynamic beside cloudflareWebAnalytics: 'strict-dynamic' makes a browser ignore host sources, and the edge injects the Web Analytics beacon with no nonce, and with an integrity that changes at each Cloudflare release, so neither a nonce nor a hash can let it run.";
        };
    };
    capsomer: {
        readonly C3: {
            readonly reason: "buildContentSecurityPolicy refuses strictDynamic beside cloudflareWebAnalytics: 'strict-dynamic' makes a browser ignore host sources, and the edge injects the Web Analytics beacon with no nonce, and with an integrity that changes at each Cloudflare release, so neither a nonce nor a hash can let it run.";
        };
    };
    prelum: {
        readonly C3: {
            readonly reason: "buildContentSecurityPolicy refuses strictDynamic beside cloudflareWebAnalytics: 'strict-dynamic' makes a browser ignore host sources, and the edge injects the Web Analytics beacon with no nonce, and with an integrity that changes at each Cloudflare release, so neither a nonce nor a hash can let it run.";
        };
    };
}>;
