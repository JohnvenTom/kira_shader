(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([
  "object" == typeof document ? document.currentScript : void 0,
  28438,
  (e, t, n) => {
    "use strict";
    Object.defineProperty(n, "__esModule", { value: !0 });
    var r = {
      assign: function () {
        return l;
      },
      searchParamsToUrlQuery: function () {
        return i;
      },
      urlQueryToSearchParams: function () {
        return s;
      },
    };
    for (var o in r) Object.defineProperty(n, o, { enumerable: !0, get: r[o] });
    function i(e) {
      let t = {};
      for (let [n, r] of e.entries()) {
        let e = t[n];
        void 0 === e
          ? (t[n] = r)
          : Array.isArray(e)
            ? e.push(r)
            : (t[n] = [e, r]);
      }
      return t;
    }
    function a(e) {
      return "string" == typeof e
        ? e
        : ("number" != typeof e || isNaN(e)) && "boolean" != typeof e
          ? ""
          : String(e);
    }
    function s(e) {
      let t = new URLSearchParams();
      for (let [n, r] of Object.entries(e))
        if (Array.isArray(r)) for (let e of r) t.append(n, a(e));
        else t.set(n, a(r));
      return t;
    }
    function l(e, ...t) {
      for (let n of t) {
        for (let t of n.keys()) e.delete(t);
        for (let [t, r] of n.entries()) e.append(t, r);
      }
      return e;
    }
  },
  84689,
  (e, t, n) => {
    "use strict";
    Object.defineProperty(n, "__esModule", { value: !0 });
    var r = {
      DecodeError: function () {
        return x;
      },
      MiddlewareNotFoundError: function () {
        return j;
      },
      MissingStaticPage: function () {
        return v;
      },
      NormalizeError: function () {
        return b;
      },
      PageNotFoundError: function () {
        return y;
      },
      SP: function () {
        return h;
      },
      ST: function () {
        return g;
      },
      WEB_VITALS: function () {
        return i;
      },
      execOnce: function () {
        return a;
      },
      getDisplayName: function () {
        return f;
      },
      getLocationOrigin: function () {
        return c;
      },
      getURL: function () {
        return u;
      },
      isAbsoluteUrl: function () {
        return l;
      },
      isResSent: function () {
        return p;
      },
      loadGetInitialProps: function () {
        return m;
      },
      normalizeRepeatedSlashes: function () {
        return d;
      },
      stringifyError: function () {
        return w;
      },
    };
    for (var o in r) Object.defineProperty(n, o, { enumerable: !0, get: r[o] });
    let i = ["CLS", "FCP", "FID", "INP", "LCP", "TTFB"];
    function a(e) {
      let t,
        n = !1;
      return (...r) => (n || ((n = !0), (t = e(...r))), t);
    }
    let s = /^[a-zA-Z][a-zA-Z\d+\-.]*?:/,
      l = (e) => s.test(e);
    function c() {
      let { protocol: e, hostname: t, port: n } = window.location;
      return `${e}//${t}${n ? ":" + n : ""}`;
    }
    function u() {
      let { href: e } = window.location,
        t = c();
      return e.substring(t.length);
    }
    function f(e) {
      return "string" == typeof e ? e : e.displayName || e.name || "Unknown";
    }
    function p(e) {
      return e.finished || e.headersSent;
    }
    function d(e) {
      let t = e.split("?");
      return (
        t[0].replace(/\\/g, "/").replace(/\/\/+/g, "/") +
        (t[1] ? `?${t.slice(1).join("?")}` : "")
      );
    }
    async function m(e, t) {
      let n = t.res || (t.ctx && t.ctx.res);
      if (!e.getInitialProps)
        return t.ctx && t.Component
          ? { pageProps: await m(t.Component, t.ctx) }
          : {};
      let r = await e.getInitialProps(t);
      if (n && p(n)) return r;
      if (!r)
        throw Object.defineProperty(
          Error(
            `"${f(e)}.getInitialProps()" should resolve to an object. But found "${r}" instead.`,
          ),
          "__NEXT_ERROR_CODE",
          { value: "E1025", enumerable: !1, configurable: !0 },
        );
      return r;
    }
    let h = "u" > typeof performance,
      g =
        h &&
        ["mark", "measure", "getEntriesByName"].every(
          (e) => "function" == typeof performance[e],
        );
    class x extends Error {}
    class b extends Error {}
    class y extends Error {
      constructor(e) {
        (super(),
          (this.code = "ENOENT"),
          (this.name = "PageNotFoundError"),
          (this.message = `Cannot find module for page: ${e}`));
      }
    }
    class v extends Error {
      constructor(e, t) {
        (super(),
          (this.message = `Failed to load static file for page: ${e} ${t}`));
      }
    }
    class j extends Error {
      constructor() {
        (super(),
          (this.code = "ENOENT"),
          (this.message = "Cannot find the middleware module"));
      }
    }
    function w(e) {
      return JSON.stringify({ message: e.message, stack: e.stack });
    }
  },
  47202,
  (e, t, n) => {
    "use strict";
    (Object.defineProperty(n, "__esModule", { value: !0 }),
      Object.defineProperty(n, "warnOnce", {
        enumerable: !0,
        get: function () {
          return r;
        },
      }));
    let r = (e) => {};
  },
  83066,
  (e, t, n) => {
    t.exports = e.r(37188);
  },
  12193,
  (e, t, n) => {
    "use strict";
    Object.defineProperty(n, "__esModule", { value: !0 });
    var r = {
      formatUrl: function () {
        return s;
      },
      formatWithValidation: function () {
        return c;
      },
      urlObjectKeys: function () {
        return l;
      },
    };
    for (var o in r) Object.defineProperty(n, o, { enumerable: !0, get: r[o] });
    let i = e.r(44066)._(e.r(28438)),
      a = /https?|ftp|gopher|file/;
    function s(e) {
      let { auth: t, hostname: n } = e,
        r = e.protocol || "",
        o = e.pathname || "",
        s = e.hash || "",
        l = e.query || "",
        c = !1;
      ((t = t ? encodeURIComponent(t).replace(/%3A/i, ":") + "@" : ""),
        e.host
          ? (c = t + e.host)
          : n &&
            ((c = t + (~n.indexOf(":") ? `[${n}]` : n)),
            e.port && (c += ":" + e.port)),
        l && "object" == typeof l && (l = String(i.urlQueryToSearchParams(l))));
      let u = e.search || (l && `?${l}`) || "";
      return (
        r && !r.endsWith(":") && (r += ":"),
        e.slashes || ((!r || a.test(r)) && !1 !== c)
          ? ((c = "//" + (c || "")), o && "/" !== o[0] && (o = "/" + o))
          : c || (c = ""),
        s && "#" !== s[0] && (s = "#" + s),
        u && "?" !== u[0] && (u = "?" + u),
        (o = o.replace(/[?#]/g, encodeURIComponent)),
        (u = u.replace("#", "%23")),
        `${r}${c}${o}${u}${s}`
      );
    }
    let l = [
      "auth",
      "hash",
      "host",
      "hostname",
      "href",
      "path",
      "pathname",
      "port",
      "protocol",
      "query",
      "search",
      "slashes",
    ];
    function c(e) {
      return s(e);
    }
  },
  64844,
  (e, t, n) => {
    "use strict";
    (Object.defineProperty(n, "__esModule", { value: !0 }),
      Object.defineProperty(n, "useMergedRef", {
        enumerable: !0,
        get: function () {
          return o;
        },
      }));
    let r = e.r(25790);
    function o(e, t) {
      let n = (0, r.useRef)(null),
        o = (0, r.useRef)(null);
      return (0, r.useCallback)(
        (r) => {
          if (null === r) {
            let e = n.current;
            e && ((n.current = null), e());
            let t = o.current;
            t && ((o.current = null), t());
          } else (e && (n.current = i(e, r)), t && (o.current = i(t, r)));
        },
        [e, t],
      );
    }
    function i(e, t) {
      if ("function" != typeof e)
        return (
          (e.current = t),
          () => {
            e.current = null;
          }
        );
      {
        let n = e(t);
        return "function" == typeof n ? n : () => e(null);
      }
    }
    ("function" == typeof n.default ||
      ("object" == typeof n.default && null !== n.default)) &&
      void 0 === n.default.__esModule &&
      (Object.defineProperty(n.default, "__esModule", { value: !0 }),
      Object.assign(n.default, n),
      (t.exports = n.default));
  },
  75940,
  (e, t, n) => {
    "use strict";
    (Object.defineProperty(n, "__esModule", { value: !0 }),
      Object.defineProperty(n, "isLocalURL", {
        enumerable: !0,
        get: function () {
          return i;
        },
      }));
    let r = e.r(84689),
      o = e.r(59337);
    function i(e) {
      if (!(0, r.isAbsoluteUrl)(e)) return !0;
      try {
        let t = (0, r.getLocationOrigin)(),
          n = new URL(e, t);
        return n.origin === t && (0, o.hasBasePath)(n.pathname);
      } catch (e) {
        return !1;
      }
    }
  },
  37481,
  (e, t, n) => {
    "use strict";
    (Object.defineProperty(n, "__esModule", { value: !0 }),
      Object.defineProperty(n, "errorOnce", {
        enumerable: !0,
        get: function () {
          return r;
        },
      }));
    let r = (e) => {};
  },
  17533,
  (e, t, n) => {
    "use strict";
    Object.defineProperty(n, "__esModule", { value: !0 });
    var r = {
      default: function () {
        return x;
      },
      useLinkStatus: function () {
        return y;
      },
    };
    for (var o in r) Object.defineProperty(n, o, { enumerable: !0, get: r[o] });
    let i = e.r(44066),
      a = e.r(35615),
      s = i._(e.r(25790)),
      l = e.r(12193),
      c = e.r(92991),
      u = e.r(64844),
      f = e.r(84689),
      p = e.r(49386);
    e.r(47202);
    let d = e.r(57045),
      m = e.r(47300),
      h = e.r(75940),
      g = e.r(48511);
    function x(t) {
      var n, r;
      let o,
        i,
        x,
        [y, v] = (0, s.useOptimistic)(m.IDLE_LINK_STATUS),
        j = (0, s.useRef)(null),
        {
          href: w,
          as: _,
          children: P,
          prefetch: C = null,
          passHref: S,
          replace: O,
          shallow: k,
          scroll: N,
          onClick: E,
          onMouseEnter: T,
          onTouchStart: A,
          legacyBehavior: L = !1,
          onNavigate: R,
          transitionTypes: M,
          ref: V,
          unstable_dynamicOnHover: I,
          ...F
        } = t;
      ((o = P),
        L &&
          ("string" == typeof o || "number" == typeof o) &&
          (o = (0, a.jsx)("a", { children: o })));
      let U = s.default.useContext(c.AppRouterContext),
        $ = !1 !== C,
        B =
          !1 !== C
            ? null === (r = C) || "auto" === r
              ? g.FetchStrategy.PPR
              : g.FetchStrategy.Full
            : g.FetchStrategy.PPR,
        q = "string" == typeof (n = _ || w) ? n : (0, l.formatUrl)(n);
      if (L) {
        if (o?.$$typeof === Symbol.for("react.lazy"))
          throw Object.defineProperty(
            Error(
              "`<Link legacyBehavior>` received a direct child that is either a Server Component, or JSX that was loaded with React.lazy(). This is not supported. Either remove legacyBehavior, or make the direct child a Client Component that renders the Link's `<a>` tag.",
            ),
            "__NEXT_ERROR_CODE",
            { value: "E863", enumerable: !1, configurable: !0 },
          );
        i = s.default.Children.only(o);
      }
      let D = L ? i && "object" == typeof i && i.ref : V,
        z = s.default.useCallback(
          (e) => (
            null !== U &&
              (j.current = (0, m.mountLinkInstance)(e, q, U, B, $, v)),
            () => {
              (j.current &&
                ((0, m.unmountLinkForCurrentNavigation)(j.current),
                (j.current = null)),
                (0, m.unmountPrefetchableInstance)(e));
            }
          ),
          [$, q, U, B, v],
        ),
        K = {
          ref: (0, u.useMergedRef)(z, D),
          onClick(t) {
            (L || "function" != typeof E || E(t),
              L &&
                i.props &&
                "function" == typeof i.props.onClick &&
                i.props.onClick(t),
              !U ||
                t.defaultPrevented ||
                (function (t, n, r, o, i, a, l) {
                  if ("u" > typeof window) {
                    let c,
                      { nodeName: u } = t.currentTarget;
                    if (
                      ("A" === u.toUpperCase() &&
                        (((c = t.currentTarget.getAttribute("target")) &&
                          "_self" !== c) ||
                          t.metaKey ||
                          t.ctrlKey ||
                          t.shiftKey ||
                          t.altKey ||
                          (t.nativeEvent && 2 === t.nativeEvent.which))) ||
                      t.currentTarget.hasAttribute("download")
                    )
                      return;
                    if (!(0, h.isLocalURL)(n)) {
                      o && (t.preventDefault(), location.replace(n));
                      return;
                    }
                    if ((t.preventDefault(), a)) {
                      let e = !1;
                      if (
                        (a({
                          preventDefault: () => {
                            e = !0;
                          },
                        }),
                        e)
                      )
                        return;
                    }
                    let { dispatchNavigateAction: f } = e.r(44177);
                    s.default.startTransition(() => {
                      f(
                        n,
                        o ? "replace" : "push",
                        !1 === i
                          ? d.ScrollBehavior.NoScroll
                          : d.ScrollBehavior.Default,
                        r.current,
                        l,
                      );
                    });
                  }
                })(t, q, j, O, N, R, M));
          },
          onMouseEnter(e) {
            (L || "function" != typeof T || T(e),
              L &&
                i.props &&
                "function" == typeof i.props.onMouseEnter &&
                i.props.onMouseEnter(e),
              U && $ && (0, m.onNavigationIntent)(e.currentTarget, !0 === I));
          },
          onTouchStart: function (e) {
            (L || "function" != typeof A || A(e),
              L &&
                i.props &&
                "function" == typeof i.props.onTouchStart &&
                i.props.onTouchStart(e),
              U && $ && (0, m.onNavigationIntent)(e.currentTarget, !0 === I));
          },
        };
      return (
        (0, f.isAbsoluteUrl)(q)
          ? (K.href = q)
          : (L && !S && ("a" !== i.type || "href" in i.props)) ||
            (K.href = (0, p.addBasePath)(q)),
        (x = L
          ? s.default.cloneElement(i, K)
          : (0, a.jsx)("a", { ...F, ...K, children: o })),
        (0, a.jsx)(b.Provider, { value: y, children: x })
      );
    }
    e.r(37481);
    let b = (0, s.createContext)(m.IDLE_LINK_STATUS),
      y = () => (0, s.useContext)(b);
    ("function" == typeof n.default ||
      ("object" == typeof n.default && null !== n.default)) &&
      void 0 === n.default.__esModule &&
      (Object.defineProperty(n.default, "__esModule", { value: !0 }),
      Object.assign(n.default, n),
      (t.exports = n.default));
  },
  43324,
  (e, t, n) => {
    var r = (function () {
      var e = String.fromCharCode,
        t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
        n = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$",
        r = {};
      function o(e, t) {
        if (!r[e]) {
          r[e] = {};
          for (var n = 0; n < e.length; n++) r[e][e.charAt(n)] = n;
        }
        return r[e][t];
      }
      var i = {
        compressToBase64: function (e) {
          if (null == e) return "";
          var n = i._compress(e, 6, function (e) {
            return t.charAt(e);
          });
          switch (n.length % 4) {
            default:
            case 0:
              return n;
            case 1:
              return n + "===";
            case 2:
              return n + "==";
            case 3:
              return n + "=";
          }
        },
        decompressFromBase64: function (e) {
          return null == e
            ? ""
            : "" == e
              ? null
              : i._decompress(e.length, 32, function (n) {
                  return o(t, e.charAt(n));
                });
        },
        compressToUTF16: function (t) {
          return null == t
            ? ""
            : i._compress(t, 15, function (t) {
                return e(t + 32);
              }) + " ";
        },
        decompressFromUTF16: function (e) {
          return null == e
            ? ""
            : "" == e
              ? null
              : i._decompress(e.length, 16384, function (t) {
                  return e.charCodeAt(t) - 32;
                });
        },
        compressToUint8Array: function (e) {
          for (
            var t = i.compress(e),
              n = new Uint8Array(2 * t.length),
              r = 0,
              o = t.length;
            r < o;
            r++
          ) {
            var a = t.charCodeAt(r);
            ((n[2 * r] = a >>> 8), (n[2 * r + 1] = a % 256));
          }
          return n;
        },
        decompressFromUint8Array: function (t) {
          if (null == t) return i.decompress(t);
          for (var n = Array(t.length / 2), r = 0, o = n.length; r < o; r++)
            n[r] = 256 * t[2 * r] + t[2 * r + 1];
          var a = [];
          return (
            n.forEach(function (t) {
              a.push(e(t));
            }),
            i.decompress(a.join(""))
          );
        },
        compressToEncodedURIComponent: function (e) {
          return null == e
            ? ""
            : i._compress(e, 6, function (e) {
                return n.charAt(e);
              });
        },
        decompressFromEncodedURIComponent: function (e) {
          return null == e
            ? ""
            : "" == e
              ? null
              : ((e = e.replace(/ /g, "+")),
                i._decompress(e.length, 32, function (t) {
                  return o(n, e.charAt(t));
                }));
        },
        compress: function (t) {
          return i._compress(t, 16, function (t) {
            return e(t);
          });
        },
        _compress: function (e, t, n) {
          if (null == e) return "";
          var r,
            o,
            i,
            a = {},
            s = {},
            l = "",
            c = "",
            u = "",
            f = 2,
            p = 3,
            d = 2,
            m = [],
            h = 0,
            g = 0;
          for (i = 0; i < e.length; i += 1)
            if (
              ((l = e.charAt(i)),
              Object.prototype.hasOwnProperty.call(a, l) ||
                ((a[l] = p++), (s[l] = !0)),
              (c = u + l),
              Object.prototype.hasOwnProperty.call(a, c))
            )
              u = c;
            else {
              if (Object.prototype.hasOwnProperty.call(s, u)) {
                if (256 > u.charCodeAt(0)) {
                  for (r = 0; r < d; r++)
                    ((h <<= 1),
                      g == t - 1 ? ((g = 0), m.push(n(h)), (h = 0)) : g++);
                  for (r = 0, o = u.charCodeAt(0); r < 8; r++)
                    ((h = (h << 1) | (1 & o)),
                      g == t - 1 ? ((g = 0), m.push(n(h)), (h = 0)) : g++,
                      (o >>= 1));
                } else {
                  for (r = 0, o = 1; r < d; r++)
                    ((h = (h << 1) | o),
                      g == t - 1 ? ((g = 0), m.push(n(h)), (h = 0)) : g++,
                      (o = 0));
                  for (r = 0, o = u.charCodeAt(0); r < 16; r++)
                    ((h = (h << 1) | (1 & o)),
                      g == t - 1 ? ((g = 0), m.push(n(h)), (h = 0)) : g++,
                      (o >>= 1));
                }
                (0 == --f && ((f = Math.pow(2, d)), d++), delete s[u]);
              } else
                for (r = 0, o = a[u]; r < d; r++)
                  ((h = (h << 1) | (1 & o)),
                    g == t - 1 ? ((g = 0), m.push(n(h)), (h = 0)) : g++,
                    (o >>= 1));
              (0 == --f && ((f = Math.pow(2, d)), d++),
                (a[c] = p++),
                (u = String(l)));
            }
          if ("" !== u) {
            if (Object.prototype.hasOwnProperty.call(s, u)) {
              if (256 > u.charCodeAt(0)) {
                for (r = 0; r < d; r++)
                  ((h <<= 1),
                    g == t - 1 ? ((g = 0), m.push(n(h)), (h = 0)) : g++);
                for (r = 0, o = u.charCodeAt(0); r < 8; r++)
                  ((h = (h << 1) | (1 & o)),
                    g == t - 1 ? ((g = 0), m.push(n(h)), (h = 0)) : g++,
                    (o >>= 1));
              } else {
                for (r = 0, o = 1; r < d; r++)
                  ((h = (h << 1) | o),
                    g == t - 1 ? ((g = 0), m.push(n(h)), (h = 0)) : g++,
                    (o = 0));
                for (r = 0, o = u.charCodeAt(0); r < 16; r++)
                  ((h = (h << 1) | (1 & o)),
                    g == t - 1 ? ((g = 0), m.push(n(h)), (h = 0)) : g++,
                    (o >>= 1));
              }
              (0 == --f && ((f = Math.pow(2, d)), d++), delete s[u]);
            } else
              for (r = 0, o = a[u]; r < d; r++)
                ((h = (h << 1) | (1 & o)),
                  g == t - 1 ? ((g = 0), m.push(n(h)), (h = 0)) : g++,
                  (o >>= 1));
            0 == --f && ((f = Math.pow(2, d)), d++);
          }
          for (r = 0, o = 2; r < d; r++)
            ((h = (h << 1) | (1 & o)),
              g == t - 1 ? ((g = 0), m.push(n(h)), (h = 0)) : g++,
              (o >>= 1));
          for (;;) {
            if (((h <<= 1), g == t - 1)) {
              m.push(n(h));
              break;
            }
            g++;
          }
          return m.join("");
        },
        decompress: function (e) {
          return null == e
            ? ""
            : "" == e
              ? null
              : i._decompress(e.length, 32768, function (t) {
                  return e.charCodeAt(t);
                });
        },
        _decompress: function (t, n, r) {
          var o,
            i,
            a,
            s,
            l,
            c,
            u,
            f = [],
            p = 4,
            d = 4,
            m = 3,
            h = "",
            g = [],
            x = { val: r(0), position: n, index: 1 };
          for (o = 0; o < 3; o += 1) f[o] = o;
          for (a = 0, l = 4, c = 1; c != l;)
            ((s = x.val & x.position),
              (x.position >>= 1),
              0 == x.position && ((x.position = n), (x.val = r(x.index++))),
              (a |= (s > 0) * c),
              (c <<= 1));
          switch (a) {
            case 0:
              for (a = 0, l = 256, c = 1; c != l;)
                ((s = x.val & x.position),
                  (x.position >>= 1),
                  0 == x.position && ((x.position = n), (x.val = r(x.index++))),
                  (a |= (s > 0) * c),
                  (c <<= 1));
              u = e(a);
              break;
            case 1:
              for (a = 0, l = 65536, c = 1; c != l;)
                ((s = x.val & x.position),
                  (x.position >>= 1),
                  0 == x.position && ((x.position = n), (x.val = r(x.index++))),
                  (a |= (s > 0) * c),
                  (c <<= 1));
              u = e(a);
              break;
            case 2:
              return "";
          }
          for (f[3] = u, i = u, g.push(u); ;) {
            if (x.index > t) return "";
            for (a = 0, l = Math.pow(2, m), c = 1; c != l;)
              ((s = x.val & x.position),
                (x.position >>= 1),
                0 == x.position && ((x.position = n), (x.val = r(x.index++))),
                (a |= (s > 0) * c),
                (c <<= 1));
            switch ((u = a)) {
              case 0:
                for (a = 0, l = 256, c = 1; c != l;)
                  ((s = x.val & x.position),
                    (x.position >>= 1),
                    0 == x.position &&
                      ((x.position = n), (x.val = r(x.index++))),
                    (a |= (s > 0) * c),
                    (c <<= 1));
                ((f[d++] = e(a)), (u = d - 1), p--);
                break;
              case 1:
                for (a = 0, l = 65536, c = 1; c != l;)
                  ((s = x.val & x.position),
                    (x.position >>= 1),
                    0 == x.position &&
                      ((x.position = n), (x.val = r(x.index++))),
                    (a |= (s > 0) * c),
                    (c <<= 1));
                ((f[d++] = e(a)), (u = d - 1), p--);
                break;
              case 2:
                return g.join("");
            }
            if ((0 == p && ((p = Math.pow(2, m)), m++), f[u])) h = f[u];
            else {
              if (u !== d) return null;
              h = i + i.charAt(0);
            }
            (g.push(h),
              (f[d++] = i + h.charAt(0)),
              p--,
              (i = h),
              0 == p && ((p = Math.pow(2, m)), m++));
          }
        },
      };
      return i;
    })();
    if ("function" == typeof define && define.amd)
      (e.r, void 0 !== r && e.v(r));
    else
      null != t
        ? (t.exports = r)
        : "u" > typeof angular &&
          null != angular &&
          angular.module("LZString", []).factory("LZString", function () {
            return r;
          });
  },
  71402,
  (e) => {
    "use strict";
    var t = e.i(59814),
      n = e.i(58547);
    let r = (0, e.i(43245).create)(() => {
      let e = (0, t.motionValue)(0),
        r = (0, t.motionValue)(0),
        o = (0, t.motionValue)(!1),
        i = (0, t.motionValue)(0),
        a = (0, t.motionValue)(0),
        s = (0, t.motionValue)(!1),
        l = (0, t.motionValue)(0),
        c = (0, t.motionValue)(0),
        u = (0, t.motionValue)(!1),
        f = (0, t.motionValue)(0),
        p = (0, t.motionValue)(0),
        d = (0, t.motionValue)(!1),
        m = (0, t.motionValue)(0);
      return {
        uiHeight: 0,
        lenis: null,
        initialAnimation: m,
        isInitialAnimationDone: (0, t.motionValue)(!1),
        scrollContainerRef: { current: null },
        mainPage: {
          scrollVelocity: e,
          scrollProgress: r,
          isLocked: o,
          snapPoints: [
            {
              id: "start",
              position: 0,
              range: {
                forward: { range: [-1e4, 0.1], multiplier: 1 },
                backward: { range: [-1e4, 0.8], multiplier: 1 },
              },
              keyboard: { autoSnapToNext: 2e3 },
            },
            {
              id: "projects",
              position: 1,
              range: {
                forward: { range: [-0.9, 0.3], multiplier: 1 },
                backward: { range: [-0.22, 0.6], multiplier: [3, 0.3] },
              },
              keyboard: { autoSnapToPrevious: 2e3, autoSnapToNext: 3e3 },
            },
            { id: "about", position: 3.4 },
            { id: "footer", position: 5 },
          ],
        },
        projectPage: {
          scrollVelocity: l,
          scrollProgress: c,
          snapPoints: [],
          isLocked: u,
        },
        accessibilityStatementPage: {
          scrollVelocity: f,
          scrollProgress: p,
          isLocked: d,
          snapPoints: [],
        },
        notFoundPage: {
          scrollVelocity: i,
          scrollProgress: a,
          isLocked: s,
          snapPoints: [
            {
              id: "start",
              position: 0,
              range: {
                forward: { range: [-1e4, 0.1], multiplier: 1 },
                backward: { range: [-1e4, 0.8], multiplier: 1 },
              },
            },
            {
              id: "end",
              position: 1,
              range: {
                forward: { range: [-0.6, 0.3], multiplier: 1 },
                backward: { range: [-0.22, 0.6], multiplier: [3, 0.3] },
              },
            },
          ],
        },
        mouse: (0, t.motionValue)(new n.Vector2(0, 0)),
      };
    });
    function o(e) {
      return e.mainPage.scrollProgress;
    }
    function i(e) {
      return e.lenis;
    }
    e.s([
      "useLenis",
      0,
      () => r(i),
      "useScrollProgress",
      0,
      () => r(o),
      "useScrollStore",
      0,
      r,
    ]);
  },
  36748,
  (e) => {
    "use strict";
    var t = e.i(59814);
    let n = (0, e.i(43245).create)(() => {
      let e = () => {},
        n = !1,
        r = new Promise((t) => {
          e = t;
        }),
        o = (e) => Math.max(0, Math.min(100, e)),
        i = (e, t, n) => {
          let r = 0.8 * e.get() + 0.2 * t.get();
          n.set(o(r));
        },
        a = ({ contentLoaded: t, videoLoaded: r, hasLoadedContent: o }) => {
          t.get() && r.get() && (o.get() || o.set(!0), n || ((n = !0), e()));
        },
        s = (0, t.motionValue)(0),
        l = (0, t.motionValue)(0),
        c = (0, t.motionValue)(0),
        u = (0, t.motionValue)(!1),
        f = (0, t.motionValue)(!1),
        p = (0, t.motionValue)(!1);
      return {
        progress: s,
        contentProgress: l,
        videoProgress: c,
        cycleProgress: (0, t.motionValue)(0),
        hasLoadedContent: p,
        isReadyToRender: (0, t.motionValue)(!1),
        warmupProgress: (0, t.motionValue)(0),
        sheetsReady: (0, t.motionValue)(!1),
        loadingScreenVisible: (0, t.motionValue)(!0),
        loadingPromise: r,
        loadingScreenOpacity: (0, t.motionValue)(1),
        setContentProgress: (e) => {
          let t = o(e);
          (t > l.get() && l.set(t), i(l, c, s));
        },
        setVideoProgress: (e) => {
          let t = o(e);
          (t > c.get() && c.set(t), i(l, c, s));
        },
        markContentLoaded: () => {
          (u.set(!0),
            l.set(100),
            i(l, c, s),
            a({ contentLoaded: u, videoLoaded: f, hasLoadedContent: p }));
        },
        markVideoLoaded: () => {
          (f.set(!0),
            c.set(100),
            i(l, c, s),
            a({ contentLoaded: u, videoLoaded: f, hasLoadedContent: p }));
        },
        resolveLoading: e,
      };
    });
    e.s(["useLoadingProgressStore", 0, n]);
  },
  14308,
  (e) => {
    e.q("/_next/static/media/draco_decoder.0fdkpp0kcv2th.wasm");
  },
  11091,
  (e) => {
    e.q("/_next/static/media/draco_wasm_wrapper.0clae7xl.~hzn.js");
  },
  48223,
  (e) => {
    e.q("/_next/static/media/draco_decoder.0._vfd0kc9~88.js");
  },
  90561,
  (e) => {
    e.q("/_next/static/media/draco_wasm_wrapper.0e41e3p6pwdbv.js");
  },
  42225,
  (e) => {
    e.q("/_next/static/media/draco_decoder.03iaqcw379p-d.wasm");
  },
  34059,
  (e) => {
    e.q("/_next/static/media/logo.0ctv.ko5~mr~7.svg");
  },
  38419,
  (e) => {
    e.q("/_next/static/media/logo_dark.0a~p9g3zi7_h6.svg");
  },
  58325,
  (e) => {
    "use strict";
    (new Proxy(
      {},
      {
        get() {
          throw Error(
            "three's UniformsUtils isn't bundled (WebGPU-only build, see next.config.ts)",
          );
        },
      },
    ),
      e.s([
        "WebGLRenderer",
        0,
        class {
          constructor() {
            throw Error(
              "three's WebGLRenderer isn't bundled (WebGPU-only build, see next.config.ts)",
            );
          }
        },
      ]));
  },
  37292,
  45017,
  (e) => {
    "use strict";
    var t = e.i(2464),
      n = e.i(58547);
    async function r({
      src: e,
      options: { crossOrigin: t = "anonymous" } = {},
    }) {
      let o = new n.TextureLoader();
      o.setCrossOrigin(t);
      let i = await o.loadAsync(e);
      return ((i.colorSpace = n.SRGBColorSpace), i);
    }
    function o(e, t = {}) {
      let {
          width: n,
          height: r = 600,
          fitMode: i = "preserve",
          time: a,
          format: s = "jpg",
        } = t,
        l = [];
      return (
        n && l.push(`w${n}`),
        r && l.push(`h${r}`),
        i && l.push(`f${i}`),
        null != a && l.push(`t${a}`),
        "webp" === s && l.push("webp"),
        `/api/mux-image/${e}/${l.join("-")}`
      );
    }
    e.s(["getMuxImageUrl", 0, o], 45017);
    let i = new Map();
    async function a(e, t = {}) {
      let { limit: n, height: r = 640, scheduleRemaining: o = !1 } = t,
        c = l(e),
        u = (null == n ? c : c.slice(0, n))
          .map((e) => e.mux_playback_id)
          .filter((e) => !!e)
          .map((e) => s(e, { height: r }));
      (o &&
        null != n &&
        n < c.length &&
        (function (e, { startIndex: t, height: n }) {
          let r = e.uid ?? e.mux_playback_id ?? "project-thumbnails",
            o = i.get(r);
          o &&
            ("idle" === o.type && "cancelIdleCallback" in window
              ? window.cancelIdleCallback(o.handle)
              : globalThis.clearTimeout(o.handle));
          let a = () => {
            (i.delete(r),
              l(e)
                .slice(t)
                .forEach((e) => {
                  e.mux_playback_id && s(e.mux_playback_id, { height: n });
                }));
          };
          if ("requestIdleCallback" in window) {
            let e = window.requestIdleCallback(a, { timeout: 1500 });
            i.set(r, { handle: e, type: "idle" });
            return;
          }
          let c = globalThis.setTimeout(a, 250);
          i.set(r, { handle: c, type: "timeout" });
        })(e, { startIndex: n, height: r }),
        await Promise.all(u));
    }
    function s(e, { height: n = 640 } = {}) {
      let i = t.useProjectsStore.getState().projectThumbnailTextures.get()[e];
      if (i) return i;
      let a = r({
        src: o(e, { height: n, fitMode: "preserve", time: 0, format: "webp" }),
      }).then((n) => {
        let r = n.image;
        if (r?.width && r.height) {
          let n = t.useProjectsStore.getState().projectAspectRatios.get();
          t.useProjectsStore
            .getState()
            .projectAspectRatios.set({ ...n, [e]: r.width / r.height });
        }
        return n;
      });
      return (
        t.useProjectsStore
          .getState()
          .projectThumbnailTextures.set({
            ...t.useProjectsStore.getState().projectThumbnailTextures.get(),
            [e]: a,
          }),
        a
      );
    }
    function l(e) {
      return (e.project_media || []).filter(
        (e, t, n) =>
          t === n.findIndex((t) => t.mux_playback_id === e.mux_playback_id),
      );
    }
    e.s(["loadProjectThumbnails", 0, a], 37292);
  },
  76500,
  (e) => {
    "use strict";
    var t = e.i(35615),
      n = e.i(26050),
      r = e.i(8594),
      o = e.i(25790),
      i = e.i(16973),
      a = e.i(90551);
    let s = ["fade", "direct", "overlay", "below"],
      l = {
        noiseVelocity: { min: 0, max: 5, step: 0.1 },
        noiseIntensity: { min: 0, max: 2, step: 0.01 },
        sepiaIntensity: { min: 0, max: 1, step: 0.01 },
        bloomIntensity: { min: 0, max: 2, step: 0.01 },
        bloomThreshold: { min: 0, max: 1, step: 0.01 },
        bloomRadius: { min: 0, max: 2, step: 0.01 },
        bloomSmoothing: { min: 0, max: 1, step: 0.01 },
        contrast: { min: 0, max: 2, step: 0.01 },
        brightness: { min: 0, max: 2, step: 0.01 },
        saturation: { min: 0, max: 1, step: 0.01 },
        lensDistortion: { min: 0, max: 1, step: 0.01 },
        lensDistortionBorders: { min: 0, max: 1, step: 0.01 },
        motionBlur: { min: 0, max: 1, step: 0.01 },
        vignetteIntensity: { min: 0, max: 1, step: 0.01 },
        vignetteRadius: { min: 0, max: 1, step: 0.01 },
        vignetteSmoothness: { min: 0, max: 1, step: 0.01 },
        pow: { min: 0, max: 5, step: 0.01 },
        chromaticAbberationStrength: { min: 0, max: 5, step: 0.01 },
      };
    function c(e) {
      let r,
        o,
        i,
        a,
        s,
        l,
        c = (0, n.c)(22),
        { label: u, value: f, onChange: p, min: d, max: m, step: h } = e,
        g = void 0 === d ? -10 : d,
        x = void 0 === m ? 10 : m,
        b = void 0 === h ? 0.01 : h;
      return (
        c[0] !== u
          ? ((r = (0, t.jsx)("label", {
              htmlFor: u,
              className:
                "text-[10px] text-white/70 w-[140px] shrink-0 truncate",
              children: u,
            })),
            (c[0] = u),
            (c[1] = r))
          : (r = c[1]),
        c[2] !== p
          ? ((o = (e) => p(Number.parseFloat(e.target.value))),
            (c[2] = p),
            (c[3] = o))
          : (o = c[3]),
        c[4] !== x || c[5] !== g || c[6] !== b || c[7] !== o || c[8] !== f
          ? ((i = (0, t.jsx)("input", {
              type: "range",
              min: g,
              max: x,
              step: b,
              value: f,
              onChange: o,
              className: "flex-1 h-1 accent-blue-400",
            })),
            (c[4] = x),
            (c[5] = g),
            (c[6] = b),
            (c[7] = o),
            (c[8] = f),
            (c[9] = i))
          : (i = c[9]),
        c[10] !== p
          ? ((a = (e) => p(Number.parseFloat(e.target.value))),
            (c[10] = p),
            (c[11] = a))
          : (a = c[11]),
        c[12] !== x || c[13] !== g || c[14] !== b || c[15] !== a || c[16] !== f
          ? ((s = (0, t.jsx)("input", {
              type: "number",
              min: g,
              max: x,
              step: b,
              value: f,
              onChange: a,
              className:
                "w-[60px] bg-white/10 text-white text-[10px] px-1 py-0.5 rounded border border-white/20 text-right",
            })),
            (c[12] = x),
            (c[13] = g),
            (c[14] = b),
            (c[15] = a),
            (c[16] = f),
            (c[17] = s))
          : (s = c[17]),
        c[18] !== r || c[19] !== i || c[20] !== s
          ? ((l = (0, t.jsxs)("div", {
              className: "flex items-center gap-2 py-0.5",
              children: [r, i, s],
            })),
            (c[18] = r),
            (c[19] = i),
            (c[20] = s),
            (c[21] = l))
          : (l = c[21]),
        l
      );
    }
    function u(e) {
      let r,
        o,
        i,
        a,
        s,
        l = (0, n.c)(19),
        { label: c, value: u, onChange: f, min: p, max: d, step: m } = e,
        h = void 0 === p ? -10 : p,
        g = void 0 === d ? 10 : d,
        x = void 0 === m ? 0.01 : m,
        b = void 0 !== u;
      return (
        l[0] !== f
          ? ((r = (e) => f(e.target.checked ? 0 : void 0)),
            (l[0] = f),
            (l[1] = r))
          : (r = l[1]),
        l[2] !== b || l[3] !== c || l[4] !== r
          ? ((o = (0, t.jsx)("input", {
              id: c,
              type: "checkbox",
              checked: b,
              onChange: r,
              className: "shrink-0",
            })),
            (l[2] = b),
            (l[3] = c),
            (l[4] = r),
            (l[5] = o))
          : (o = l[5]),
        l[6] !== c
          ? ((i = (0, t.jsx)("label", {
              htmlFor: c,
              className:
                "text-[10px] text-white/70 w-[120px] shrink-0 truncate",
              children: c,
            })),
            (l[6] = c),
            (l[7] = i))
          : (i = l[7]),
        l[8] !== b ||
        l[9] !== g ||
        l[10] !== h ||
        l[11] !== f ||
        l[12] !== x ||
        l[13] !== u
          ? ((a =
              b &&
              (0, t.jsxs)(t.Fragment, {
                children: [
                  (0, t.jsx)("input", {
                    type: "range",
                    min: h,
                    max: g,
                    step: x,
                    value: u,
                    onChange: (e) => f(Number.parseFloat(e.target.value)),
                    className: "flex-1 h-1 accent-blue-400",
                  }),
                  (0, t.jsx)("input", {
                    type: "number",
                    min: h,
                    max: g,
                    step: x,
                    value: u,
                    onChange: (e) => f(Number.parseFloat(e.target.value)),
                    className:
                      "w-[60px] bg-white/10 text-white text-[10px] px-1 py-0.5 rounded border border-white/20 text-right",
                  }),
                ],
              })),
            (l[8] = b),
            (l[9] = g),
            (l[10] = h),
            (l[11] = f),
            (l[12] = x),
            (l[13] = u),
            (l[14] = a))
          : (a = l[14]),
        l[15] !== o || l[16] !== i || l[17] !== a
          ? ((s = (0, t.jsxs)("div", {
              className: "flex items-center gap-2 py-0.5",
              children: [o, i, a],
            })),
            (l[15] = o),
            (l[16] = i),
            (l[17] = a),
            (l[18] = s))
          : (s = l[18]),
        s
      );
    }
    function f(e) {
      let r,
        i,
        a,
        s,
        l,
        c,
        u = (0, n.c)(16),
        { title: f, children: p, defaultOpen: d } = e,
        [m, h] = (0, o.useState)(void 0 !== d && d);
      (u[0] !== m ? ((r = () => h(!m)), (u[0] = m), (u[1] = r)) : (r = u[1]),
        u[2] !== f
          ? ((i = (0, t.jsx)("span", { children: f })), (u[2] = f), (u[3] = i))
          : (i = u[3]));
      let g = m ? "−" : "+";
      return (
        u[4] !== g
          ? ((a = (0, t.jsx)("span", {
              className: "text-white/40",
              children: g,
            })),
            (u[4] = g),
            (u[5] = a))
          : (a = u[5]),
        u[6] !== r || u[7] !== i || u[8] !== a
          ? ((s = (0, t.jsxs)("button", {
              type: "button",
              onClick: r,
              className:
                "w-full flex items-center justify-between py-1.5 px-1 text-[11px] text-white/90 hover:bg-white/5",
              children: [i, a],
            })),
            (u[6] = r),
            (u[7] = i),
            (u[8] = a),
            (u[9] = s))
          : (s = u[9]),
        u[10] !== p || u[11] !== m
          ? ((l =
              m && (0, t.jsx)("div", { className: "px-1 pb-2", children: p })),
            (u[10] = p),
            (u[11] = m),
            (u[12] = l))
          : (l = u[12]),
        u[13] !== s || u[14] !== l
          ? ((c = (0, t.jsxs)("div", {
              className: "border-b border-white/10",
              children: [s, l],
            })),
            (u[13] = s),
            (u[14] = l),
            (u[15] = c))
          : (c = u[15]),
        c
      );
    }
    function p(e) {
      let r,
        o,
        i,
        a = (0, n.c)(14),
        { effects: s, onChange: u } = e;
      a[0] !== s || a[1] !== u
        ? ((r = (e, t) => {
            u({ ...s, [e]: t });
          }),
          (a[0] = s),
          (a[1] = u),
          (a[2] = r))
        : (r = a[2]);
      let f = r;
      a[3] !== s
        ? ((o = async () => {
            await navigator.clipboard.writeText(JSON.stringify(s, null, 2));
          }),
          (a[3] = s),
          (a[4] = o))
        : (o = a[4]);
      let p = o;
      if (a[5] !== p || a[6] !== s || a[7] !== f) {
        let e,
          n,
          r = [...Object.keys(l)].sort(d);
        (a[9] !== p
          ? ((e = (0, t.jsx)("div", {
              className: "flex justify-end py-1",
              children: (0, t.jsx)("button", {
                type: "button",
                onClick: () => void p(),
                className:
                  "text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded hover:bg-blue-500/30",
                children: "Copy effects",
              }),
            })),
            (a[9] = p),
            (a[10] = e))
          : (e = a[10]),
          a[11] !== s || a[12] !== f
            ? ((n = (e) => {
                let n = l[e];
                return (0, t.jsx)(
                  c,
                  {
                    label: e,
                    value: s[e],
                    onChange: (t) => f(e, t),
                    min: n.min,
                    max: n.max,
                    step: n.step,
                  },
                  e,
                );
              }),
              (a[11] = s),
              (a[12] = f),
              (a[13] = n))
            : (n = a[13]),
          (i = (0, t.jsxs)("div", { children: [e, r.map(n)] })),
          (a[5] = p),
          (a[6] = s),
          (a[7] = f),
          (a[8] = i));
      } else i = a[8];
      return i;
    }
    function d(e, t) {
      return e.localeCompare(t);
    }
    function m(e) {
      let r,
        o,
        i,
        a,
        s,
        l,
        c = (0, n.c)(17),
        { label: f, value: p, onChange: d } = e,
        m = void 0 !== p;
      return (
        c[0] !== d
          ? ((r = (e) => d(e.target.checked ? {} : void 0)),
            (c[0] = d),
            (c[1] = r))
          : (r = c[1]),
        c[2] !== m || c[3] !== r
          ? ((o = (0, t.jsx)("input", {
              type: "checkbox",
              checked: m,
              onChange: r,
              className: "shrink-0",
            })),
            (c[2] = m),
            (c[3] = r),
            (c[4] = o))
          : (o = c[4]),
        c[5] !== f
          ? ((i = (0, t.jsx)("span", {
              className: "text-[10px] text-white/70",
              children: f,
            })),
            (c[5] = f),
            (c[6] = i))
          : (i = c[6]),
        c[7] !== o || c[8] !== i
          ? ((a = (0, t.jsxs)("div", {
              className: "flex items-center gap-2 py-0.5",
              children: [o, i],
            })),
            (c[7] = o),
            (c[8] = i),
            (c[9] = a))
          : (a = c[9]),
        c[10] !== m || c[11] !== d || c[12] !== p
          ? ((s =
              m &&
              (0, t.jsxs)("div", {
                className: "pl-4",
                children: [
                  (0, t.jsx)(u, {
                    label: "start",
                    value: p.start,
                    onChange: (e) => d({ ...p, start: e }),
                    min: -5,
                    max: 5,
                  }),
                  (0, t.jsx)(u, {
                    label: "end",
                    value: p.end,
                    onChange: (e) => d({ ...p, end: e }),
                    min: -5,
                    max: 5,
                  }),
                ],
              })),
            (c[10] = m),
            (c[11] = d),
            (c[12] = p),
            (c[13] = s))
          : (s = c[13]),
        c[14] !== a || c[15] !== s
          ? ((l = (0, t.jsxs)("div", { children: [a, s] })),
            (c[14] = a),
            (c[15] = s),
            (c[16] = l))
          : (l = c[16]),
        l
      );
    }
    function h(e) {
      let r,
        o,
        i,
        a,
        s,
        l,
        c = (0, n.c)(15),
        { value: f, onChange: p } = e,
        d = void 0 !== f;
      return (
        c[0] !== p
          ? ((r = (e) => p(e.target.checked ? {} : void 0)),
            (c[0] = p),
            (c[1] = r))
          : (r = c[1]),
        c[2] !== d || c[3] !== r
          ? ((o = (0, t.jsx)("input", {
              type: "checkbox",
              checked: d,
              onChange: r,
              className: "shrink-0",
            })),
            (c[2] = d),
            (c[3] = r),
            (c[4] = o))
          : (o = c[4]),
        c[5] === Symbol.for("react.memo_cache_sentinel")
          ? ((i = (0, t.jsx)("span", {
              className: "text-[10px] text-white/70",
              children: "renderOffset",
            })),
            (c[5] = i))
          : (i = c[5]),
        c[6] !== o
          ? ((a = (0, t.jsxs)("div", {
              className: "flex items-center gap-2 py-0.5",
              children: [o, i],
            })),
            (c[6] = o),
            (c[7] = a))
          : (a = c[7]),
        c[8] !== d || c[9] !== p || c[10] !== f
          ? ((s =
              d &&
              (0, t.jsxs)("div", {
                className: "pl-4",
                children: [
                  (0, t.jsx)(u, {
                    label: "beforeStart",
                    value: f.beforeStart,
                    onChange: (e) => p({ ...f, beforeStart: e }),
                    min: 0,
                    max: 5,
                  }),
                  (0, t.jsx)(u, {
                    label: "afterEnd",
                    value: f.afterEnd,
                    onChange: (e) => p({ ...f, afterEnd: e }),
                    min: -2,
                    max: 5,
                  }),
                ],
              })),
            (c[8] = d),
            (c[9] = p),
            (c[10] = f),
            (c[11] = s))
          : (s = c[11]),
        c[12] !== a || c[13] !== s
          ? ((l = (0, t.jsxs)("div", { children: [a, s] })),
            (c[12] = a),
            (c[13] = s),
            (c[14] = l))
          : (l = c[14]),
        l
      );
    }
    function g(e) {
      let r,
        o,
        i,
        l,
        d,
        g,
        y,
        v,
        j,
        w,
        _,
        P,
        C,
        S,
        O,
        k,
        N,
        E,
        T,
        A,
        L,
        R,
        M,
        V,
        I,
        F,
        U,
        $,
        B,
        q,
        D = (0, n.c)(78),
        { page: z } = e,
        K = (0, a.usePagesStore)(b);
      D[0] !== z.id || D[1] !== K
        ? ((r = (e) => {
            K(z.id, e);
          }),
          (D[0] = z.id),
          (D[1] = K),
          (D[2] = r))
        : (r = D[2]);
      let W = r,
        G = z.id;
      (D[3] !== W
        ? ((o = (e) => W({ length: e })), (D[3] = W), (D[4] = o))
        : (o = D[4]),
        D[5] !== z.length || D[6] !== o
          ? ((i = (0, t.jsx)(c, {
              label: "length",
              value: z.length,
              onChange: o,
              min: 0,
              max: 20,
              step: 0.05,
            })),
            (D[5] = z.length),
            (D[6] = o),
            (D[7] = i))
          : (i = D[7]),
        D[8] !== W
          ? ((l = (e) => W({ transitionLength: e })), (D[8] = W), (D[9] = l))
          : (l = D[9]),
        D[10] !== z.transitionLength || D[11] !== l
          ? ((d = (0, t.jsx)(c, {
              label: "transitionLength",
              value: z.transitionLength,
              onChange: l,
              min: 0,
              max: 5,
              step: 0.05,
            })),
            (D[10] = z.transitionLength),
            (D[11] = l),
            (D[12] = d))
          : (d = D[12]),
        D[13] !== W
          ? ((g = (e) => W({ effectTransitionLength: e })),
            (D[13] = W),
            (D[14] = g))
          : (g = D[14]),
        D[15] !== z.effectTransitionLength || D[16] !== g
          ? ((y = (0, t.jsx)(u, {
              label: "effectTransitionLength",
              value: z.effectTransitionLength,
              onChange: g,
              min: 0,
              max: 5,
            })),
            (D[15] = z.effectTransitionLength),
            (D[16] = g),
            (D[17] = y))
          : (y = D[17]),
        D[18] !== W
          ? ((v = (e) => W({ effectOffset: e })), (D[18] = W), (D[19] = v))
          : (v = D[19]),
        D[20] !== z.effectOffset || D[21] !== v
          ? ((j = (0, t.jsx)(u, {
              label: "effectOffset",
              value: z.effectOffset,
              onChange: v,
              min: -5,
              max: 5,
            })),
            (D[20] = z.effectOffset),
            (D[21] = v),
            (D[22] = j))
          : (j = D[22]),
        D[23] !== W
          ? ((w = (e) => W({ transitionOffset: e })), (D[23] = W), (D[24] = w))
          : (w = D[24]),
        D[25] !== z.transitionOffset || D[26] !== w
          ? ((_ = (0, t.jsx)(u, {
              label: "transitionOffset",
              value: z.transitionOffset,
              onChange: w,
              min: -5,
              max: 5,
            })),
            (D[25] = z.transitionOffset),
            (D[26] = w),
            (D[27] = _))
          : (_ = D[27]),
        D[28] === Symbol.for("react.memo_cache_sentinel")
          ? ((P = (0, t.jsx)("label", {
              htmlFor: "transition",
              className: "text-[10px] text-white/70 w-[140px] shrink-0",
              children: "transition",
            })),
            (D[28] = P))
          : (P = D[28]));
      let J = z.transition;
      return (
        D[29] !== W
          ? ((C = (e) => W({ transition: e.target.value })),
            (D[29] = W),
            (D[30] = C))
          : (C = D[30]),
        D[31] === Symbol.for("react.memo_cache_sentinel")
          ? ((S = s.map(x)), (D[31] = S))
          : (S = D[31]),
        D[32] !== z.transition || D[33] !== C
          ? ((O = (0, t.jsxs)("div", {
              className: "flex items-center gap-2 py-0.5",
              children: [
                P,
                (0, t.jsx)("select", {
                  id: "transition",
                  value: J,
                  onChange: C,
                  className:
                    "flex-1 bg-white/10 text-white text-[10px] px-1 py-0.5 rounded border border-white/20",
                  children: S,
                }),
              ],
            })),
            (D[32] = z.transition),
            (D[33] = C),
            (D[34] = O))
          : (O = D[34]),
        D[35] === Symbol.for("react.memo_cache_sentinel")
          ? ((k = (0, t.jsx)("label", {
              htmlFor: "uiMode",
              className: "text-[10px] text-white/70 w-[140px] shrink-0",
              children: "uiMode",
            })),
            (D[35] = k))
          : (k = D[35]),
        D[36] !== W
          ? ((N = (e) => W({ uiMode: e.target.value })),
            (D[36] = W),
            (D[37] = N))
          : (N = D[37]),
        D[38] === Symbol.for("react.memo_cache_sentinel")
          ? ((E = (0, t.jsx)("option", { value: "dark", children: "dark" })),
            (T = (0, t.jsx)("option", { value: "light", children: "light" })),
            (D[38] = E),
            (D[39] = T))
          : ((E = D[38]), (T = D[39])),
        D[40] !== z.uiMode || D[41] !== N
          ? ((A = (0, t.jsxs)("div", {
              className: "flex items-center gap-2 py-0.5",
              children: [
                k,
                (0, t.jsxs)("select", {
                  value: z.uiMode,
                  onChange: N,
                  className:
                    "flex-1 bg-white/10 text-white text-[10px] px-1 py-0.5 rounded border border-white/20",
                  children: [E, T],
                }),
              ],
            })),
            (D[40] = z.uiMode),
            (D[41] = N),
            (D[42] = A))
          : (A = D[42]),
        D[43] !== W
          ? ((L = (e) => W({ pageOffset: e })), (D[43] = W), (D[44] = L))
          : (L = D[44]),
        D[45] !== z.pageOffset || D[46] !== L
          ? ((R = (0, t.jsx)(m, {
              label: "pageOffset",
              value: z.pageOffset,
              onChange: L,
            })),
            (D[45] = z.pageOffset),
            (D[46] = L),
            (D[47] = R))
          : (R = D[47]),
        D[48] !== W
          ? ((M = (e) => W({ uiPageOffset: e })), (D[48] = W), (D[49] = M))
          : (M = D[49]),
        D[50] !== z.uiPageOffset || D[51] !== M
          ? ((V = (0, t.jsx)(m, {
              label: "uiPageOffset",
              value: z.uiPageOffset,
              onChange: M,
            })),
            (D[50] = z.uiPageOffset),
            (D[51] = M),
            (D[52] = V))
          : (V = D[52]),
        D[53] !== W
          ? ((I = (e) => W({ renderOffset: e })), (D[53] = W), (D[54] = I))
          : (I = D[54]),
        D[55] !== z.renderOffset || D[56] !== I
          ? ((F = (0, t.jsx)(h, { value: z.renderOffset, onChange: I })),
            (D[55] = z.renderOffset),
            (D[56] = I),
            (D[57] = F))
          : (F = D[57]),
        D[58] !== W
          ? ((U = (e) => W({ effects: e })), (D[58] = W), (D[59] = U))
          : (U = D[59]),
        D[60] !== z.effects || D[61] !== U
          ? (($ = (0, t.jsx)(f, {
              title: "effects",
              children: (0, t.jsx)(p, { effects: z.effects, onChange: U }),
            })),
            (D[60] = z.effects),
            (D[61] = U),
            (D[62] = $))
          : ($ = D[62]),
        D[63] !== j ||
        D[64] !== _ ||
        D[65] !== O ||
        D[66] !== A ||
        D[67] !== R ||
        D[68] !== V ||
        D[69] !== F ||
        D[70] !== $ ||
        D[71] !== i ||
        D[72] !== d ||
        D[73] !== y
          ? ((B = (0, t.jsxs)("div", {
              className: "space-y-1",
              children: [i, d, y, j, _, O, A, R, V, F, $],
            })),
            (D[63] = j),
            (D[64] = _),
            (D[65] = O),
            (D[66] = A),
            (D[67] = R),
            (D[68] = V),
            (D[69] = F),
            (D[70] = $),
            (D[71] = i),
            (D[72] = d),
            (D[73] = y),
            (D[74] = B))
          : (B = D[74]),
        D[75] !== z.id || D[76] !== B
          ? ((q = (0, t.jsx)(f, { title: G, defaultOpen: !1, children: B })),
            (D[75] = z.id),
            (D[76] = B),
            (D[77] = q))
          : (q = D[77]),
        q
      );
    }
    function x(e) {
      return (0, t.jsx)("option", { value: e, children: e }, e);
    }
    function b(e) {
      return e.updatePage;
    }
    async function y(e) {
      let t = e.map(({ range: e, renderRange: t, ...n }) => n);
      await navigator.clipboard.writeText(JSON.stringify(t, null, 2));
    }
    function v(e) {
      return (0, t.jsx)(g, { page: e }, e.id);
    }
    function j(e) {
      return e.resetPages;
    }
    function w(e) {
      return e.pages;
    }
    e.s([
      "PagesEditor",
      0,
      function () {
        let e,
          s,
          l,
          c,
          u,
          d,
          m,
          h,
          g,
          x,
          b,
          _,
          P,
          C,
          S,
          O,
          k,
          N,
          E,
          T,
          A = (0, n.c)(36),
          L = (0, a.usePagesStore)(w),
          R = (0, a.usePagesStore)(j);
        A[0] === Symbol.for("react.memo_cache_sentinel")
          ? ((e = []), (A[0] = e))
          : (e = A[0]);
        let [M, V] = (0, o.useState)(e);
        A[1] === Symbol.for("react.memo_cache_sentinel")
          ? ((s = { ...i.projectPageEffectsConfig }), (A[1] = s))
          : (s = A[1]);
        let [I, F] = (0, o.useState)(s);
        A[2] === Symbol.for("react.memo_cache_sentinel")
          ? ((l = { ...i.notFoundPageEffectsConfig }), (A[2] = l))
          : (l = A[2]);
        let [U, $] = (0, o.useState)(l);
        A[3] === Symbol.for("react.memo_cache_sentinel")
          ? ((c = { ...i.loadingPageEffectsConfig }), (A[3] = c))
          : (c = A[3]);
        let [B, q] = (0, o.useState)(c),
          [D, z] = (0, o.useState)(!1);
        if (
          (A[4] !== L
            ? ((u = () => {
                V(L.get());
              }),
              (d = [L]),
              (A[4] = L),
              (A[5] = u),
              (A[6] = d))
            : ((u = A[5]), (d = A[6])),
          (0, o.useEffect)(u, d),
          (0, r.useMotionValueEvent)(L, "change", V),
          !D)
        ) {
          let e;
          return (
            A[7] === Symbol.for("react.memo_cache_sentinel")
              ? ((e = (0, t.jsx)("button", {
                  type: "button",
                  onClick: () => z(!0),
                  className:
                    "fixed top-4 right-4 z-[100000001] bg-white/10 backdrop-blur text-white text-xs px-3 py-1.5 rounded hover:bg-white/20",
                  tabIndex: -1,
                  children: "Pages Editor",
                })),
                (A[7] = e))
              : (e = A[7]),
            e
          );
        }
        return (
          A[8] === Symbol.for("react.memo_cache_sentinel")
            ? ((m = (0, t.jsx)("span", {
                className: "text-xs font-medium",
                children: "Pages Editor",
              })),
              (A[8] = m))
            : (m = A[8]),
          A[9] !== R
            ? ((h = (0, t.jsx)("button", {
                type: "button",
                onClick: R,
                className:
                  "text-[10px] bg-white/10 text-white/70 px-2 py-0.5 rounded hover:bg-white/20",
                children: "Reset",
              })),
              (A[9] = R),
              (A[10] = h))
            : (h = A[10]),
          A[11] !== M
            ? ((g = (0, t.jsx)("button", {
                type: "button",
                onClick: () => void y(M),
                className:
                  "text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded hover:bg-blue-500/30",
                children: "Copy JSON",
              })),
              (A[11] = M),
              (A[12] = g))
            : (g = A[12]),
          A[13] === Symbol.for("react.memo_cache_sentinel")
            ? ((x = (0, t.jsx)("button", {
                type: "button",
                onClick: () => z(!1),
                className: "text-white/50 hover:text-white text-sm",
                children: "✕",
              })),
              (A[13] = x))
            : (x = A[13]),
          A[14] !== h || A[15] !== g
            ? ((b = (0, t.jsxs)("div", {
                className:
                  "flex items-center justify-between px-3 py-2 border-b border-white/10",
                children: [
                  m,
                  (0, t.jsxs)("div", {
                    className: "flex gap-2",
                    children: [h, g, x],
                  }),
                ],
              })),
              (A[14] = h),
              (A[15] = g),
              (A[16] = b))
            : (b = A[16]),
          A[17] === Symbol.for("react.memo_cache_sentinel")
            ? ((_ = (e) => {
                (Object.assign(i.projectPageEffectsConfig, e),
                  F({ ...i.projectPageEffectsConfig }));
              }),
              (A[17] = _))
            : (_ = A[17]),
          A[18] !== I
            ? ((P = (0, t.jsx)(f, {
                title: "project page effects",
                defaultOpen: !1,
                children: (0, t.jsx)(p, { effects: I, onChange: _ }),
              })),
              (A[18] = I),
              (A[19] = P))
            : (P = A[19]),
          A[20] === Symbol.for("react.memo_cache_sentinel")
            ? ((C = (e) => {
                (Object.assign(i.notFoundPageEffectsConfig, e),
                  $({ ...i.notFoundPageEffectsConfig }));
              }),
              (A[20] = C))
            : (C = A[20]),
          A[21] !== U
            ? ((S = (0, t.jsx)(f, {
                title: "not-found page effects",
                defaultOpen: !1,
                children: (0, t.jsx)(p, { effects: U, onChange: C }),
              })),
              (A[21] = U),
              (A[22] = S))
            : (S = A[22]),
          A[23] === Symbol.for("react.memo_cache_sentinel")
            ? ((O = (e) => {
                (Object.assign(i.loadingPageEffectsConfig, e),
                  q({ ...i.loadingPageEffectsConfig }));
              }),
              (A[23] = O))
            : (O = A[23]),
          A[24] !== B
            ? ((k = (0, t.jsx)(f, {
                title: "loading page effects",
                defaultOpen: !1,
                children: (0, t.jsx)(p, { effects: B, onChange: O }),
              })),
              (A[24] = B),
              (A[25] = k))
            : (k = A[25]),
          A[26] !== M
            ? ((N = M.map(v)), (A[26] = M), (A[27] = N))
            : (N = A[27]),
          A[28] !== P || A[29] !== S || A[30] !== k || A[31] !== N
            ? ((E = (0, t.jsxs)("div", {
                className: "flex-1 overflow-y-auto",
                children: [P, S, k, N],
              })),
              (A[28] = P),
              (A[29] = S),
              (A[30] = k),
              (A[31] = N),
              (A[32] = E))
            : (E = A[32]),
          A[33] !== b || A[34] !== E
            ? ((T = (0, t.jsxs)("div", {
                className:
                  "fixed top-0 right-0 z-[100000001] w-[360px] h-full bg-black/90 backdrop-blur-md text-white overflow-hidden flex flex-col border-l border-white/10",
                children: [b, E],
              })),
              (A[33] = b),
              (A[34] = E),
              (A[35] = T))
            : (T = A[35]),
          T
        );
      },
    ]);
  },
  63592,
  (e) => {
    e.v((t) =>
      Promise.all(["static/chunks/01t8oqdveqr.r.js"].map((t) => e.l(t))).then(
        () => t(93046),
      ),
    );
  },
  79744,
  (e) => {
    e.v((e) => Promise.resolve().then(() => e(70131)));
  },
]);
