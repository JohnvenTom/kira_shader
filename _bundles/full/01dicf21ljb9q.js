(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([
  "object" == typeof document ? document.currentScript : void 0,
  86536,
  (e) => {
    "use strict";
    let t = {
      hero: "hero",
      projects: "selected-work",
      office: "about-us",
      "about-us": "about-us",
      "golden-tie-reveal": "contact",
      "golden-tie": "contact",
      contact: "contact",
    };
    e.s([
      "getMainPageHashRoute",
      0,
      function (e) {
        let n = e.startsWith("#") ? e.slice(1) : e;
        return Object.values(t).includes(n)
          ? (Object.entries(t).findLast(([, e]) => e === n)?.[0] ?? null)
          : null;
      },
      "getMainPageHref",
      0,
      function (e) {
        let n = t[e];
        return "hero" === e ? "/" : `/#${n}`;
      },
      "isMainPageHashPageType",
      0,
      function (e) {
        return e in t;
      },
    ]);
  },
  2464,
  (e) => {
    "use strict";
    var t = e.i(59814);
    let n = (0, e.i(43245).create)((e, n) => ({
      isHoveringDragArea: (0, t.motionValue)(!1),
      isDragging: (0, t.motionValue)(!1),
      selectedProjectIndex: (0, t.motionValue)(0),
      projectThumbnailTextures: (0, t.motionValue)({}),
      reelThumbnailTextures: (0, t.motionValue)({}),
      reelThumbnailTexturePromises: (0, t.motionValue)({}),
      reelThumbnailTextureOrder: (0, t.motionValue)([]),
      projectAspectRatios: (0, t.motionValue)({}),
      prismicProjects: (0, t.motionValue)([]),
      initialized: (0, t.motionValue)(!1),
      projectTransition: (0, t.motionValue)(0),
      dragOffset: (0, t.motionValue)(0),
      projectIsHovered: (0, t.motionValue)(!1),
      getActiveProject: () => {
        let e = n().prismicProjects.get().length,
          t = n().selectedProjectIndex.get();
        return n().prismicProjects.get()[(t + 1e3 * e) % e];
      },
    }));
    e.s(["useProjectsStore", 0, n]);
  },
  75609,
  (e, t, n) => {
    "use strict";
    var r = Object.prototype.hasOwnProperty,
      i = Object.prototype.toString,
      o = Object.defineProperty,
      s = Object.getOwnPropertyDescriptor,
      a = function (e) {
        return "function" == typeof Array.isArray
          ? Array.isArray(e)
          : "[object Array]" === i.call(e);
      },
      u = function (e) {
        if (!e || "[object Object]" !== i.call(e)) return !1;
        var t,
          n = r.call(e, "constructor"),
          o =
            e.constructor &&
            e.constructor.prototype &&
            r.call(e.constructor.prototype, "isPrototypeOf");
        if (e.constructor && !n && !o) return !1;
        for (t in e);
        return void 0 === t || r.call(e, t);
      },
      c = function (e, t) {
        o && "__proto__" === t.name
          ? o(e, t.name, {
              enumerable: !0,
              configurable: !0,
              value: t.newValue,
              writable: !0,
            })
          : (e[t.name] = t.newValue);
      },
      l = function (e, t) {
        if ("__proto__" === t) {
          if (!r.call(e, t)) return;
          else if (s) return s(e, t).value;
        }
        return e[t];
      };
    t.exports = function e() {
      var t,
        n,
        r,
        i,
        o,
        s,
        f = arguments[0],
        h = 1,
        d = arguments.length,
        p = !1;
      for (
        "boolean" == typeof f && ((p = f), (f = arguments[1] || {}), (h = 2)),
          (null == f || ("object" != typeof f && "function" != typeof f)) &&
            (f = {});
        h < d;
        ++h
      )
        if (((t = arguments[h]), null != t))
          for (n in t)
            ((r = l(f, n)),
              f !== (i = l(t, n)) &&
                (p && i && (u(i) || (o = a(i)))
                  ? (o
                      ? ((o = !1), (s = r && a(r) ? r : []))
                      : (s = r && u(r) ? r : {}),
                    c(f, { name: n, newValue: e(p, s, i) }))
                  : void 0 !== i && c(f, { name: n, newValue: i })));
      return f;
    };
  },
  44664,
  (e) => {
    "use strict";
    let t = {};
    function n(e, n) {
      let i = n || t;
      return r(
        e,
        "boolean" != typeof i.includeImageAlt || i.includeImageAlt,
        "boolean" != typeof i.includeHtml || i.includeHtml,
      );
    }
    function r(e, t, n) {
      var r;
      if ((r = e) && "object" == typeof r) {
        if ("value" in e) return "html" !== e.type || n ? e.value : "";
        if (t && "alt" in e && e.alt) return e.alt;
        if ("children" in e) return i(e.children, t, n);
      }
      return Array.isArray(e) ? i(e, t, n) : "";
    }
    function i(e, t, n) {
      let i = [],
        o = -1;
      for (; ++o < e.length;) i[o] = r(e[o], t, n);
      return i.join("");
    }
    function o(e, t, n, r) {
      let i,
        o = e.length,
        s = 0;
      if (
        ((t = t < 0 ? (-t > o ? 0 : o + t) : t > o ? o : t),
        (n = n > 0 ? n : 0),
        r.length < 1e4)
      )
        ((i = Array.from(r)).unshift(t, n), e.splice(...i));
      else
        for (n && e.splice(t, n); s < r.length;)
          ((i = r.slice(s, s + 1e4)).unshift(t, 0),
            e.splice(...i),
            (s += 1e4),
            (t += 1e4));
    }
    function s(e, t) {
      return e.length > 0 ? (o(e, e.length, 0, t), e) : t;
    }
    let a = {}.hasOwnProperty,
      u = v(/[A-Za-z]/),
      c = v(/[\dA-Za-z]/),
      l = v(/[#-'*+\--9=?A-Z^-~]/);
    function f(e) {
      return null !== e && (e < 32 || 127 === e);
    }
    let h = v(/\d/),
      d = v(/[\dA-Fa-f]/),
      p = v(/[!-/:-@[-`{-~]/);
    function g(e) {
      return null !== e && e < -2;
    }
    function m(e) {
      return null !== e && (e < 0 || 32 === e);
    }
    function y(e) {
      return -2 === e || -1 === e || 32 === e;
    }
    let k = v(/\p{P}|\p{S}/u),
      x = v(/\s/);
    function v(e) {
      return function (t) {
        return null !== t && t > -1 && e.test(String.fromCharCode(t));
      };
    }
    function b(e, t, n, r) {
      let i = r ? r - 1 : 1 / 0,
        o = 0;
      return function (r) {
        return y(r)
          ? (e.enter(n),
            (function r(s) {
              return y(s) && o++ < i ? (e.consume(s), r) : (e.exit(n), t(s));
            })(r))
          : t(r);
      };
    }
    let w = {
        tokenize: function (e) {
          let t,
            n = e.attempt(
              this.parser.constructs.contentInitial,
              function (t) {
                return null === t
                  ? void e.consume(t)
                  : (e.enter("lineEnding"),
                    e.consume(t),
                    e.exit("lineEnding"),
                    b(e, n, "linePrefix"));
              },
              function (n) {
                return (
                  e.enter("paragraph"),
                  (function n(r) {
                    let i = e.enter("chunkText", {
                      contentType: "text",
                      previous: t,
                    });
                    return (
                      t && (t.next = i),
                      (t = i),
                      (function t(r) {
                        if (null === r) {
                          (e.exit("chunkText"),
                            e.exit("paragraph"),
                            e.consume(r));
                          return;
                        }
                        return g(r)
                          ? (e.consume(r), e.exit("chunkText"), n)
                          : (e.consume(r), t);
                      })(r)
                    );
                  })(n)
                );
              },
            );
          return n;
        },
      },
      S = {
        tokenize: function (e) {
          let t,
            n,
            r,
            i = this,
            s = [],
            a = 0;
          return u;
          function u(t) {
            if (a < s.length) {
              let n = s[a];
              return (
                (i.containerState = n[1]),
                e.attempt(n[0].continuation, c, l)(t)
              );
            }
            return l(t);
          }
          function c(e) {
            if ((a++, i.containerState._closeFlow)) {
              let n;
              ((i.containerState._closeFlow = void 0), t && x());
              let r = i.events.length,
                s = r;
              for (; s--;)
                if (
                  "exit" === i.events[s][0] &&
                  "chunkFlow" === i.events[s][1].type
                ) {
                  n = i.events[s][1].end;
                  break;
                }
              k(a);
              let u = r;
              for (; u < i.events.length;)
                ((i.events[u][1].end = { ...n }), u++);
              return (
                o(i.events, s + 1, 0, i.events.slice(r)),
                (i.events.length = u),
                l(e)
              );
            }
            return u(e);
          }
          function l(n) {
            if (a === s.length) {
              if (!t) return d(n);
              if (t.currentConstruct && t.currentConstruct.concrete)
                return m(n);
              i.interrupt = !!(
                t.currentConstruct && !t._gfmTableDynamicInterruptHack
              );
            }
            return ((i.containerState = {}), e.check(T, f, h)(n));
          }
          function f(e) {
            return (t && x(), k(a), d(e));
          }
          function h(e) {
            return (
              (i.parser.lazy[i.now().line] = a !== s.length),
              (r = i.now().offset),
              m(e)
            );
          }
          function d(t) {
            return ((i.containerState = {}), e.attempt(T, p, m)(t));
          }
          function p(e) {
            return (a++, s.push([i.currentConstruct, i.containerState]), d(e));
          }
          function m(r) {
            if (null === r) {
              (t && x(), k(0), e.consume(r));
              return;
            }
            return (
              (t = t || i.parser.flow(i.now())),
              e.enter("chunkFlow", {
                _tokenizer: t,
                contentType: "flow",
                previous: n,
              }),
              (function t(n) {
                if (null === n) {
                  (y(e.exit("chunkFlow"), !0), k(0), e.consume(n));
                  return;
                }
                return g(n)
                  ? (e.consume(n),
                    y(e.exit("chunkFlow")),
                    (a = 0),
                    (i.interrupt = void 0),
                    u)
                  : (e.consume(n), t);
              })(r)
            );
          }
          function y(e, s) {
            let u = i.sliceStream(e);
            if (
              (s && u.push(null),
              (e.previous = n),
              n && (n.next = e),
              (n = e),
              t.defineSkip(e.start),
              t.write(u),
              i.parser.lazy[e.start.line])
            ) {
              let e,
                n,
                s = t.events.length;
              for (; s--;)
                if (
                  t.events[s][1].start.offset < r &&
                  (!t.events[s][1].end || t.events[s][1].end.offset > r)
                )
                  return;
              let u = i.events.length,
                c = u;
              for (; c--;)
                if (
                  "exit" === i.events[c][0] &&
                  "chunkFlow" === i.events[c][1].type
                ) {
                  if (e) {
                    n = i.events[c][1].end;
                    break;
                  }
                  e = !0;
                }
              for (k(a), s = u; s < i.events.length;)
                ((i.events[s][1].end = { ...n }), s++);
              (o(i.events, c + 1, 0, i.events.slice(u)), (i.events.length = s));
            }
          }
          function k(t) {
            let n = s.length;
            for (; n-- > t;) {
              let t = s[n];
              ((i.containerState = t[1]), t[0].exit.call(i, e));
            }
            s.length = t;
          }
          function x() {
            (t.write([null]),
              (n = void 0),
              (t = void 0),
              (i.containerState._closeFlow = void 0));
          }
        },
      },
      T = {
        tokenize: function (e, t, n) {
          return b(
            e,
            e.attempt(this.parser.constructs.document, t, n),
            "linePrefix",
            this.parser.constructs.disable.null.includes("codeIndented")
              ? void 0
              : 4,
          );
        },
      },
      P = {
        partial: !0,
        tokenize: function (e, t, n) {
          return function (t) {
            return y(t) ? b(e, r, "linePrefix")(t) : r(t);
          };
          function r(e) {
            return null === e || g(e) ? t(e) : n(e);
          }
        },
      };
    class I {
      constructor(e) {
        ((this.left = e ? [...e] : []), (this.right = []));
      }
      get(e) {
        if (e < 0 || e >= this.left.length + this.right.length)
          throw RangeError(
            "Cannot access index `" +
              e +
              "` in a splice buffer of size `" +
              (this.left.length + this.right.length) +
              "`",
          );
        return e < this.left.length
          ? this.left[e]
          : this.right[this.right.length - e + this.left.length - 1];
      }
      get length() {
        return this.left.length + this.right.length;
      }
      shift() {
        return (this.setCursor(0), this.right.pop());
      }
      slice(e, t) {
        let n = null == t ? 1 / 0 : t;
        return n < this.left.length
          ? this.left.slice(e, n)
          : e > this.left.length
            ? this.right
                .slice(
                  this.right.length - n + this.left.length,
                  this.right.length - e + this.left.length,
                )
                .reverse()
            : this.left
                .slice(e)
                .concat(
                  this.right
                    .slice(this.right.length - n + this.left.length)
                    .reverse(),
                );
      }
      splice(e, t, n) {
        this.setCursor(Math.trunc(e));
        let r = this.right.splice(this.right.length - (t || 0), 1 / 0);
        return (n && E(this.left, n), r.reverse());
      }
      pop() {
        return (this.setCursor(1 / 0), this.left.pop());
      }
      push(e) {
        (this.setCursor(1 / 0), this.left.push(e));
      }
      pushMany(e) {
        (this.setCursor(1 / 0), E(this.left, e));
      }
      unshift(e) {
        (this.setCursor(0), this.right.push(e));
      }
      unshiftMany(e) {
        (this.setCursor(0), E(this.right, e.reverse()));
      }
      setCursor(e) {
        if (
          e !== this.left.length &&
          (!(e > this.left.length) || 0 !== this.right.length) &&
          (!(e < 0) || 0 !== this.left.length)
        )
          if (e < this.left.length) {
            let t = this.left.splice(e, 1 / 0);
            E(this.right, t.reverse());
          } else {
            let t = this.right.splice(
              this.left.length + this.right.length - e,
              1 / 0,
            );
            E(this.left, t.reverse());
          }
      }
    }
    function E(e, t) {
      let n = 0;
      if (t.length < 1e4) e.push(...t);
      else for (; n < t.length;) (e.push(...t.slice(n, n + 1e4)), (n += 1e4));
    }
    function z(e) {
      let t,
        n,
        r,
        i,
        s,
        a,
        u,
        c = {},
        l = -1,
        f = new I(e);
      for (; ++l < f.length;) {
        for (; l in c;) l = c[l];
        if (
          ((t = f.get(l)),
          l &&
            "chunkFlow" === t[1].type &&
            "listItemPrefix" === f.get(l - 1)[1].type &&
            ((r = 0) < (a = t[1]._tokenizer.events).length &&
              "lineEndingBlank" === a[r][1].type &&
              (r += 2),
            r < a.length && "content" === a[r][1].type))
        )
          for (; ++r < a.length && "content" !== a[r][1].type;)
            "chunkText" === a[r][1].type &&
              ((a[r][1]._isInFirstContentOfListItem = !0), r++);
        if ("enter" === t[0])
          t[1].contentType &&
            (Object.assign(
              c,
              (function (e, t) {
                let n,
                  r,
                  i = e.get(t)[1],
                  o = e.get(t)[2],
                  s = t - 1,
                  a = [],
                  u = i._tokenizer;
                !u &&
                  ((u = o.parser[i.contentType](i.start)),
                  i._contentTypeTextTrailing &&
                    (u._contentTypeTextTrailing = !0));
                let c = u.events,
                  l = [],
                  f = {},
                  h = -1,
                  d = i,
                  p = 0,
                  g = 0,
                  m = [0];
                for (; d;) {
                  for (; e.get(++s)[1] !== d;);
                  (a.push(s),
                    !d._tokenizer &&
                      ((n = o.sliceStream(d)),
                      d.next || n.push(null),
                      r && u.defineSkip(d.start),
                      d._isInFirstContentOfListItem &&
                        (u._gfmTasklistFirstContentOfListItem = !0),
                      u.write(n),
                      d._isInFirstContentOfListItem &&
                        (u._gfmTasklistFirstContentOfListItem = void 0)),
                    (r = d),
                    (d = d.next));
                }
                for (d = i; ++h < c.length;)
                  "exit" === c[h][0] &&
                    "enter" === c[h - 1][0] &&
                    c[h][1].type === c[h - 1][1].type &&
                    c[h][1].start.line !== c[h][1].end.line &&
                    ((g = h + 1),
                    m.push(g),
                    (d._tokenizer = void 0),
                    (d.previous = void 0),
                    (d = d.next));
                for (
                  u.events = [],
                    d
                      ? ((d._tokenizer = void 0), (d.previous = void 0))
                      : m.pop(),
                    h = m.length;
                  h--;
                ) {
                  let t = c.slice(m[h], m[h + 1]),
                    n = a.pop();
                  (l.push([n, n + t.length - 1]), e.splice(n, 2, t));
                }
                for (l.reverse(), h = -1; ++h < l.length;)
                  ((f[p + l[h][0]] = p + l[h][1]),
                    (p += l[h][1] - l[h][0] - 1));
                return f;
              })(f, l),
            ),
            (l = c[l]),
            (u = !0));
        else if (t[1]._container) {
          for (r = l, n = void 0; r--;)
            if (
              "lineEnding" === (i = f.get(r))[1].type ||
              "lineEndingBlank" === i[1].type
            )
              "enter" === i[0] &&
                (n && (f.get(n)[1].type = "lineEndingBlank"),
                (i[1].type = "lineEnding"),
                (n = r));
            else if (
              "linePrefix" === i[1].type ||
              "listItemIndent" === i[1].type
            );
            else break;
          n &&
            ((t[1].end = { ...f.get(n)[1].start }),
            (s = f.slice(n, l)).unshift(t),
            f.splice(n, l - n + 1, s));
        }
      }
      return (o(e, 0, 1 / 0, f.slice(0)), !u);
    }
    let A = {
        resolve: function (e) {
          return (z(e), e);
        },
        tokenize: function (e, t) {
          let n;
          return function (t) {
            return (
              e.enter("content"),
              (n = e.enter("chunkContent", { contentType: "content" })),
              r(t)
            );
          };
          function r(t) {
            return null === t
              ? i(t)
              : g(t)
                ? e.check(C, o, i)(t)
                : (e.consume(t), r);
          }
          function i(n) {
            return (e.exit("chunkContent"), e.exit("content"), t(n));
          }
          function o(t) {
            return (
              e.consume(t),
              e.exit("chunkContent"),
              (n.next = e.enter("chunkContent", {
                contentType: "content",
                previous: n,
              })),
              (n = n.next),
              r
            );
          }
        },
      },
      C = {
        partial: !0,
        tokenize: function (e, t, n) {
          let r = this;
          return function (t) {
            return (
              e.exit("chunkContent"),
              e.enter("lineEnding"),
              e.consume(t),
              e.exit("lineEnding"),
              b(e, i, "linePrefix")
            );
          };
          function i(i) {
            if (null === i || g(i)) return n(i);
            let o = r.events[r.events.length - 1];
            return !r.parser.constructs.disable.null.includes("codeIndented") &&
              o &&
              "linePrefix" === o[1].type &&
              o[2].sliceSerialize(o[1], !0).length >= 4
              ? t(i)
              : e.interrupt(r.parser.constructs.flow, n, t)(i);
          }
        },
      },
      F = {
        tokenize: function (e) {
          let t = this,
            n = e.attempt(
              P,
              function (r) {
                return null === r
                  ? void e.consume(r)
                  : (e.enter("lineEndingBlank"),
                    e.consume(r),
                    e.exit("lineEndingBlank"),
                    (t.currentConstruct = void 0),
                    n);
              },
              e.attempt(
                this.parser.constructs.flowInitial,
                r,
                b(
                  e,
                  e.attempt(this.parser.constructs.flow, r, e.attempt(A, r)),
                  "linePrefix",
                ),
              ),
            );
          return n;
          function r(r) {
            return null === r
              ? void e.consume(r)
              : (e.enter("lineEnding"),
                e.consume(r),
                e.exit("lineEnding"),
                (t.currentConstruct = void 0),
                n);
          }
        },
      },
      _ = { resolveAll: j() },
      M = D("string"),
      L = D("text");
    function D(e) {
      return {
        resolveAll: j("text" === e ? R : void 0),
        tokenize: function (t) {
          let n = this,
            r = this.parser.constructs[e],
            i = t.attempt(r, o, s);
          return o;
          function o(e) {
            return u(e) ? i(e) : s(e);
          }
          function s(e) {
            return null === e
              ? void t.consume(e)
              : (t.enter("data"), t.consume(e), a);
          }
          function a(e) {
            return u(e) ? (t.exit("data"), i(e)) : (t.consume(e), a);
          }
          function u(e) {
            if (null === e) return !0;
            let t = r[e],
              i = -1;
            if (t)
              for (; ++i < t.length;) {
                let e = t[i];
                if (!e.previous || e.previous.call(n, n.previous)) return !0;
              }
            return !1;
          }
        },
      };
    }
    function j(e) {
      return function (t, n) {
        let r,
          i = -1;
        for (; ++i <= t.length;)
          void 0 === r
            ? t[i] && "data" === t[i][1].type && ((r = i), i++)
            : (t[i] && "data" === t[i][1].type) ||
              (i !== r + 2 &&
                ((t[r][1].end = t[i - 1][1].end),
                t.splice(r + 2, i - r - 2),
                (i = r + 2)),
              (r = void 0));
        return e ? e(t, n) : t;
      };
    }
    function R(e, t) {
      let n = 0;
      for (; ++n <= e.length;)
        if (
          (n === e.length || "lineEnding" === e[n][1].type) &&
          "data" === e[n - 1][1].type
        ) {
          let r,
            i = e[n - 1][1],
            o = t.sliceStream(i),
            s = o.length,
            a = -1,
            u = 0;
          for (; s--;) {
            let e = o[s];
            if ("string" == typeof e) {
              for (a = e.length; 32 === e.charCodeAt(a - 1);) (u++, a--);
              if (a) break;
              a = -1;
            } else if (-2 === e) ((r = !0), u++);
            else if (-1 === e);
            else {
              s++;
              break;
            }
          }
          if ((t._contentTypeTextTrailing && n === e.length && (u = 0), u)) {
            let o = {
              type:
                n === e.length || r || u < 2
                  ? "lineSuffix"
                  : "hardBreakTrailing",
              start: {
                _bufferIndex: s ? a : i.start._bufferIndex + a,
                _index: i.start._index + s,
                line: i.end.line,
                column: i.end.column - u,
                offset: i.end.offset - u,
              },
              end: { ...i.end },
            };
            ((i.end = { ...o.start }),
              i.start.offset === i.end.offset
                ? Object.assign(i, o)
                : (e.splice(n, 0, ["enter", o, t], ["exit", o, t]), (n += 2)));
          }
          n++;
        }
      return e;
    }
    function O(e) {
      return null === e || m(e) || x(e) ? 1 : k(e) ? 2 : void 0;
    }
    function B(e, t, n) {
      let r = [],
        i = -1;
      for (; ++i < e.length;) {
        let o = e[i].resolveAll;
        o && !r.includes(o) && ((t = o(t, n)), r.push(o));
      }
      return t;
    }
    let H = {
      name: "attention",
      resolveAll: function (e, t) {
        let n,
          r,
          i,
          a,
          u,
          c,
          l,
          f,
          h = -1;
        for (; ++h < e.length;)
          if (
            "enter" === e[h][0] &&
            "attentionSequence" === e[h][1].type &&
            e[h][1]._close
          ) {
            for (n = h; n--;)
              if (
                "exit" === e[n][0] &&
                "attentionSequence" === e[n][1].type &&
                e[n][1]._open &&
                t.sliceSerialize(e[n][1]).charCodeAt(0) ===
                  t.sliceSerialize(e[h][1]).charCodeAt(0)
              ) {
                if (
                  (e[n][1]._close || e[h][1]._open) &&
                  (e[h][1].end.offset - e[h][1].start.offset) % 3 &&
                  !(
                    (e[n][1].end.offset -
                      e[n][1].start.offset +
                      e[h][1].end.offset -
                      e[h][1].start.offset) %
                    3
                  )
                )
                  continue;
                c =
                  e[n][1].end.offset - e[n][1].start.offset > 1 &&
                  e[h][1].end.offset - e[h][1].start.offset > 1
                    ? 2
                    : 1;
                let d = { ...e[n][1].end },
                  p = { ...e[h][1].start };
                (V(d, -c),
                  V(p, c),
                  (a = {
                    type: c > 1 ? "strongSequence" : "emphasisSequence",
                    start: d,
                    end: { ...e[n][1].end },
                  }),
                  (u = {
                    type: c > 1 ? "strongSequence" : "emphasisSequence",
                    start: { ...e[h][1].start },
                    end: p,
                  }),
                  (i = {
                    type: c > 1 ? "strongText" : "emphasisText",
                    start: { ...e[n][1].end },
                    end: { ...e[h][1].start },
                  }),
                  (r = {
                    type: c > 1 ? "strong" : "emphasis",
                    start: { ...a.start },
                    end: { ...u.end },
                  }),
                  (e[n][1].end = { ...a.start }),
                  (e[h][1].start = { ...u.end }),
                  (l = []),
                  e[n][1].end.offset - e[n][1].start.offset &&
                    (l = s(l, [
                      ["enter", e[n][1], t],
                      ["exit", e[n][1], t],
                    ])),
                  (l = s(l, [
                    ["enter", r, t],
                    ["enter", a, t],
                    ["exit", a, t],
                    ["enter", i, t],
                  ])),
                  (l = s(
                    l,
                    B(
                      t.parser.constructs.insideSpan.null,
                      e.slice(n + 1, h),
                      t,
                    ),
                  )),
                  (l = s(l, [
                    ["exit", i, t],
                    ["enter", u, t],
                    ["exit", u, t],
                    ["exit", r, t],
                  ])),
                  e[h][1].end.offset - e[h][1].start.offset
                    ? ((f = 2),
                      (l = s(l, [
                        ["enter", e[h][1], t],
                        ["exit", e[h][1], t],
                      ])))
                    : (f = 0),
                  o(e, n - 1, h - n + 3, l),
                  (h = n + l.length - f - 2));
                break;
              }
          }
        for (h = -1; ++h < e.length;)
          "attentionSequence" === e[h][1].type && (e[h][1].type = "data");
        return e;
      },
      tokenize: function (e, t) {
        let n,
          r = this.parser.constructs.attentionMarkers.null,
          i = this.previous,
          o = O(i);
        return function (s) {
          return (
            (n = s),
            e.enter("attentionSequence"),
            (function s(a) {
              if (a === n) return (e.consume(a), s);
              let u = e.exit("attentionSequence"),
                c = O(a),
                l = !c || (2 === c && o) || r.includes(a),
                f = !o || (2 === o && c) || r.includes(i);
              return (
                (u._open = !!(42 === n ? l : l && (o || !f))),
                (u._close = !!(42 === n ? f : f && (c || !l))),
                t(a)
              );
            })(s)
          );
        };
      },
    };
    function V(e, t) {
      ((e.column += t), (e.offset += t), (e._bufferIndex += t));
    }
    let W = {
        continuation: {
          tokenize: function (e, t, n) {
            let r = this;
            return function (t) {
              return y(t)
                ? b(
                    e,
                    i,
                    "linePrefix",
                    r.parser.constructs.disable.null.includes("codeIndented")
                      ? void 0
                      : 4,
                  )(t)
                : i(t);
            };
            function i(r) {
              return e.attempt(W, t, n)(r);
            }
          },
        },
        exit: function (e) {
          e.exit("blockQuote");
        },
        name: "blockQuote",
        tokenize: function (e, t, n) {
          let r = this;
          return function (t) {
            if (62 === t) {
              let n = r.containerState;
              return (
                n.open ||
                  (e.enter("blockQuote", { _container: !0 }), (n.open = !0)),
                e.enter("blockQuotePrefix"),
                e.enter("blockQuoteMarker"),
                e.consume(t),
                e.exit("blockQuoteMarker"),
                i
              );
            }
            return n(t);
          };
          function i(n) {
            return y(n)
              ? (e.enter("blockQuotePrefixWhitespace"),
                e.consume(n),
                e.exit("blockQuotePrefixWhitespace"),
                e.exit("blockQuotePrefix"),
                t)
              : (e.exit("blockQuotePrefix"), t(n));
          }
        },
      },
      q = {
        name: "characterEscape",
        tokenize: function (e, t, n) {
          return function (t) {
            return (
              e.enter("characterEscape"),
              e.enter("escapeMarker"),
              e.consume(t),
              e.exit("escapeMarker"),
              r
            );
          };
          function r(r) {
            return p(r)
              ? (e.enter("characterEscapeValue"),
                e.consume(r),
                e.exit("characterEscapeValue"),
                e.exit("characterEscape"),
                t)
              : n(r);
          }
        },
      },
      U = document.createElement("i");
    function N(e) {
      let t = "&" + e + ";";
      U.innerHTML = t;
      let n = U.textContent;
      return (
        (59 !== n.charCodeAt(n.length - 1) || "semi" === e) && n !== t && n
      );
    }
    let Q = {
        name: "characterReference",
        tokenize: function (e, t, n) {
          let r,
            i,
            o = this,
            s = 0;
          return function (t) {
            return (
              e.enter("characterReference"),
              e.enter("characterReferenceMarker"),
              e.consume(t),
              e.exit("characterReferenceMarker"),
              a
            );
          };
          function a(t) {
            return 35 === t
              ? (e.enter("characterReferenceMarkerNumeric"),
                e.consume(t),
                e.exit("characterReferenceMarkerNumeric"),
                u)
              : (e.enter("characterReferenceValue"), (r = 31), (i = c), l(t));
          }
          function u(t) {
            return 88 === t || 120 === t
              ? (e.enter("characterReferenceMarkerHexadecimal"),
                e.consume(t),
                e.exit("characterReferenceMarkerHexadecimal"),
                e.enter("characterReferenceValue"),
                (r = 6),
                (i = d),
                l)
              : (e.enter("characterReferenceValue"), (r = 7), (i = h), l(t));
          }
          function l(a) {
            if (59 === a && s) {
              let r = e.exit("characterReferenceValue");
              return i !== c || N(o.sliceSerialize(r))
                ? (e.enter("characterReferenceMarker"),
                  e.consume(a),
                  e.exit("characterReferenceMarker"),
                  e.exit("characterReference"),
                  t)
                : n(a);
            }
            return i(a) && s++ < r ? (e.consume(a), l) : n(a);
          }
        },
      },
      G = {
        partial: !0,
        tokenize: function (e, t, n) {
          let r = this;
          return function (t) {
            return null === t
              ? n(t)
              : (e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), i);
          };
          function i(e) {
            return r.parser.lazy[r.now().line] ? n(e) : t(e);
          }
        },
      },
      $ = {
        concrete: !0,
        name: "codeFenced",
        tokenize: function (e, t, n) {
          let r,
            i = this,
            o = {
              partial: !0,
              tokenize: function (e, t, n) {
                let o = 0;
                return function (t) {
                  return (
                    e.enter("lineEnding"),
                    e.consume(t),
                    e.exit("lineEnding"),
                    s
                  );
                };
                function s(t) {
                  return (
                    e.enter("codeFencedFence"),
                    y(t)
                      ? b(
                          e,
                          u,
                          "linePrefix",
                          i.parser.constructs.disable.null.includes(
                            "codeIndented",
                          )
                            ? void 0
                            : 4,
                        )(t)
                      : u(t)
                  );
                }
                function u(t) {
                  return t === r
                    ? (e.enter("codeFencedFenceSequence"),
                      (function t(i) {
                        return i === r
                          ? (o++, e.consume(i), t)
                          : o >= a
                            ? (e.exit("codeFencedFenceSequence"),
                              y(i) ? b(e, c, "whitespace")(i) : c(i))
                            : n(i);
                      })(t))
                    : n(t);
                }
                function c(r) {
                  return null === r || g(r)
                    ? (e.exit("codeFencedFence"), t(r))
                    : n(r);
                }
              },
            },
            s = 0,
            a = 0;
          return function (t) {
            var o;
            let c;
            return (
              (o = t),
              (s =
                (c = i.events[i.events.length - 1]) &&
                "linePrefix" === c[1].type
                  ? c[2].sliceSerialize(c[1], !0).length
                  : 0),
              (r = o),
              e.enter("codeFenced"),
              e.enter("codeFencedFence"),
              e.enter("codeFencedFenceSequence"),
              (function t(i) {
                return i === r
                  ? (a++, e.consume(i), t)
                  : a < 3
                    ? n(i)
                    : (e.exit("codeFencedFenceSequence"),
                      y(i) ? b(e, u, "whitespace")(i) : u(i));
              })(o)
            );
          };
          function u(o) {
            return null === o || g(o)
              ? (e.exit("codeFencedFence"),
                i.interrupt ? t(o) : e.check(G, l, p)(o))
              : (e.enter("codeFencedFenceInfo"),
                e.enter("chunkString", { contentType: "string" }),
                (function t(i) {
                  return null === i || g(i)
                    ? (e.exit("chunkString"),
                      e.exit("codeFencedFenceInfo"),
                      u(i))
                    : y(i)
                      ? (e.exit("chunkString"),
                        e.exit("codeFencedFenceInfo"),
                        b(e, c, "whitespace")(i))
                      : 96 === i && i === r
                        ? n(i)
                        : (e.consume(i), t);
                })(o));
          }
          function c(t) {
            return null === t || g(t)
              ? u(t)
              : (e.enter("codeFencedFenceMeta"),
                e.enter("chunkString", { contentType: "string" }),
                (function t(i) {
                  return null === i || g(i)
                    ? (e.exit("chunkString"),
                      e.exit("codeFencedFenceMeta"),
                      u(i))
                    : 96 === i && i === r
                      ? n(i)
                      : (e.consume(i), t);
                })(t));
          }
          function l(t) {
            return e.attempt(o, p, f)(t);
          }
          function f(t) {
            return (
              e.enter("lineEnding"),
              e.consume(t),
              e.exit("lineEnding"),
              h
            );
          }
          function h(t) {
            return s > 0 && y(t) ? b(e, d, "linePrefix", s + 1)(t) : d(t);
          }
          function d(t) {
            return null === t || g(t)
              ? e.check(G, l, p)(t)
              : (e.enter("codeFlowValue"),
                (function t(n) {
                  return null === n || g(n)
                    ? (e.exit("codeFlowValue"), d(n))
                    : (e.consume(n), t);
                })(t));
          }
          function p(n) {
            return (e.exit("codeFenced"), t(n));
          }
        },
      },
      Z = {
        name: "codeIndented",
        tokenize: function (e, t, n) {
          let r = this;
          return function (t) {
            return (e.enter("codeIndented"), b(e, i, "linePrefix", 5)(t));
          };
          function i(t) {
            let i = r.events[r.events.length - 1];
            return i &&
              "linePrefix" === i[1].type &&
              i[2].sliceSerialize(i[1], !0).length >= 4
              ? (function t(n) {
                  return null === n
                    ? o(n)
                    : g(n)
                      ? e.attempt(K, t, o)(n)
                      : (e.enter("codeFlowValue"),
                        (function n(r) {
                          return null === r || g(r)
                            ? (e.exit("codeFlowValue"), t(r))
                            : (e.consume(r), n);
                        })(n));
                })(t)
              : n(t);
          }
          function o(n) {
            return (e.exit("codeIndented"), t(n));
          }
        },
      },
      K = {
        partial: !0,
        tokenize: function (e, t, n) {
          let r = this;
          return i;
          function i(t) {
            return r.parser.lazy[r.now().line]
              ? n(t)
              : g(t)
                ? (e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), i)
                : b(e, o, "linePrefix", 5)(t);
          }
          function o(e) {
            let o = r.events[r.events.length - 1];
            return o &&
              "linePrefix" === o[1].type &&
              o[2].sliceSerialize(o[1], !0).length >= 4
              ? t(e)
              : g(e)
                ? i(e)
                : n(e);
          }
        },
      };
    function Y(e, t, n, r, i, o, s, a, u) {
      let c = u || 1 / 0,
        l = 0;
      return function (t) {
        return 60 === t
          ? (e.enter(r), e.enter(i), e.enter(o), e.consume(t), e.exit(o), h)
          : null === t || 32 === t || 41 === t || f(t)
            ? n(t)
            : (e.enter(r),
              e.enter(s),
              e.enter(a),
              e.enter("chunkString", { contentType: "string" }),
              y(t));
      };
      function h(n) {
        return 62 === n
          ? (e.enter(o), e.consume(n), e.exit(o), e.exit(i), e.exit(r), t)
          : (e.enter(a),
            e.enter("chunkString", { contentType: "string" }),
            d(n));
      }
      function d(t) {
        return 62 === t
          ? (e.exit("chunkString"), e.exit(a), h(t))
          : null === t || 60 === t || g(t)
            ? n(t)
            : (e.consume(t), 92 === t ? p : d);
      }
      function p(t) {
        return 60 === t || 62 === t || 92 === t ? (e.consume(t), d) : d(t);
      }
      function y(i) {
        return !l && (null === i || 41 === i || m(i))
          ? (e.exit("chunkString"), e.exit(a), e.exit(s), e.exit(r), t(i))
          : l < c && 40 === i
            ? (e.consume(i), l++, y)
            : 41 === i
              ? (e.consume(i), l--, y)
              : null === i || 32 === i || 40 === i || f(i)
                ? n(i)
                : (e.consume(i), 92 === i ? k : y);
      }
      function k(t) {
        return 40 === t || 41 === t || 92 === t ? (e.consume(t), y) : y(t);
      }
    }
    function J(e, t, n, r, i, o) {
      let s,
        a = this,
        u = 0;
      return function (t) {
        return (e.enter(r), e.enter(i), e.consume(t), e.exit(i), e.enter(o), c);
      };
      function c(f) {
        return u > 999 ||
          null === f ||
          91 === f ||
          (93 === f && !s) ||
          (94 === f && !u && "_hiddenFootnoteSupport" in a.parser.constructs)
          ? n(f)
          : 93 === f
            ? (e.exit(o), e.enter(i), e.consume(f), e.exit(i), e.exit(r), t)
            : g(f)
              ? (e.enter("lineEnding"), e.consume(f), e.exit("lineEnding"), c)
              : (e.enter("chunkString", { contentType: "string" }), l(f));
      }
      function l(t) {
        return null === t || 91 === t || 93 === t || g(t) || u++ > 999
          ? (e.exit("chunkString"), c(t))
          : (e.consume(t), s || (s = !y(t)), 92 === t ? f : l);
      }
      function f(t) {
        return 91 === t || 92 === t || 93 === t ? (e.consume(t), u++, l) : l(t);
      }
    }
    function X(e, t, n, r, i, o) {
      let s;
      return function (t) {
        return 34 === t || 39 === t || 40 === t
          ? (e.enter(r),
            e.enter(i),
            e.consume(t),
            e.exit(i),
            (s = 40 === t ? 41 : t),
            a)
          : n(t);
      };
      function a(n) {
        return n === s
          ? (e.enter(i), e.consume(n), e.exit(i), e.exit(r), t)
          : (e.enter(o), u(n));
      }
      function u(t) {
        return t === s
          ? (e.exit(o), a(s))
          : null === t
            ? n(t)
            : g(t)
              ? (e.enter("lineEnding"),
                e.consume(t),
                e.exit("lineEnding"),
                b(e, u, "linePrefix"))
              : (e.enter("chunkString", { contentType: "string" }), c(t));
      }
      function c(t) {
        return t === s || null === t || g(t)
          ? (e.exit("chunkString"), u(t))
          : (e.consume(t), 92 === t ? l : c);
      }
      function l(t) {
        return t === s || 92 === t ? (e.consume(t), c) : c(t);
      }
    }
    function ee(e, t) {
      let n;
      return function r(i) {
        return g(i)
          ? (e.enter("lineEnding"),
            e.consume(i),
            e.exit("lineEnding"),
            (n = !0),
            r)
          : y(i)
            ? b(e, r, n ? "linePrefix" : "lineSuffix")(i)
            : t(i);
      };
    }
    function et(e) {
      return e
        .replace(/[\t\n\r ]+/g, " ")
        .replace(/^ | $/g, "")
        .toLowerCase()
        .toUpperCase();
    }
    let en = {
        partial: !0,
        tokenize: function (e, t, n) {
          return function (t) {
            return m(t) ? ee(e, r)(t) : n(t);
          };
          function r(t) {
            return X(
              e,
              i,
              n,
              "definitionTitle",
              "definitionTitleMarker",
              "definitionTitleString",
            )(t);
          }
          function i(t) {
            return y(t) ? b(e, o, "whitespace")(t) : o(t);
          }
          function o(e) {
            return null === e || g(e) ? t(e) : n(e);
          }
        },
      },
      er = [
        "address",
        "article",
        "aside",
        "base",
        "basefont",
        "blockquote",
        "body",
        "caption",
        "center",
        "col",
        "colgroup",
        "dd",
        "details",
        "dialog",
        "dir",
        "div",
        "dl",
        "dt",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "frame",
        "frameset",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "head",
        "header",
        "hr",
        "html",
        "iframe",
        "legend",
        "li",
        "link",
        "main",
        "menu",
        "menuitem",
        "nav",
        "noframes",
        "ol",
        "optgroup",
        "option",
        "p",
        "param",
        "search",
        "section",
        "summary",
        "table",
        "tbody",
        "td",
        "tfoot",
        "th",
        "thead",
        "title",
        "tr",
        "track",
        "ul",
      ],
      ei = ["pre", "script", "style", "textarea"],
      eo = {
        partial: !0,
        tokenize: function (e, t, n) {
          return function (r) {
            return (
              e.enter("lineEnding"),
              e.consume(r),
              e.exit("lineEnding"),
              e.attempt(P, t, n)
            );
          };
        },
      },
      es = {
        partial: !0,
        tokenize: function (e, t, n) {
          let r = this;
          return function (t) {
            return g(t)
              ? (e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), i)
              : n(t);
          };
          function i(e) {
            return r.parser.lazy[r.now().line] ? n(e) : t(e);
          }
        },
      },
      ea = {
        name: "labelEnd",
        resolveAll: function (e) {
          let t = -1,
            n = [];
          for (; ++t < e.length;) {
            let r = e[t][1];
            if (
              (n.push(e[t]),
              "labelImage" === r.type ||
                "labelLink" === r.type ||
                "labelEnd" === r.type)
            ) {
              let e = "labelImage" === r.type ? 4 : 2;
              ((r.type = "data"), (t += e));
            }
          }
          return (e.length !== n.length && o(e, 0, e.length, n), e);
        },
        resolveTo: function (e, t) {
          let n,
            r,
            i,
            a,
            u = e.length,
            c = 0;
          for (; u--;)
            if (((n = e[u][1]), r)) {
              if ("link" === n.type || ("labelLink" === n.type && n._inactive))
                break;
              "enter" === e[u][0] &&
                "labelLink" === n.type &&
                (n._inactive = !0);
            } else if (i) {
              if (
                "enter" === e[u][0] &&
                ("labelImage" === n.type || "labelLink" === n.type) &&
                !n._balanced &&
                ((r = u), "labelLink" !== n.type)
              ) {
                c = 2;
                break;
              }
            } else "labelEnd" === n.type && (i = u);
          let l = {
              type: "labelLink" === e[r][1].type ? "link" : "image",
              start: { ...e[r][1].start },
              end: { ...e[e.length - 1][1].end },
            },
            f = {
              type: "label",
              start: { ...e[r][1].start },
              end: { ...e[i][1].end },
            },
            h = {
              type: "labelText",
              start: { ...e[r + c + 2][1].end },
              end: { ...e[i - 2][1].start },
            };
          return (
            (a = s(
              (a = [
                ["enter", l, t],
                ["enter", f, t],
              ]),
              e.slice(r + 1, r + c + 3),
            )),
            (a = s(a, [["enter", h, t]])),
            (a = s(
              a,
              B(
                t.parser.constructs.insideSpan.null,
                e.slice(r + c + 4, i - 3),
                t,
              ),
            )),
            (a = s(a, [["exit", h, t], e[i - 2], e[i - 1], ["exit", f, t]])),
            (a = s(a, e.slice(i + 1))),
            (a = s(a, [["exit", l, t]])),
            o(e, r, e.length, a),
            e
          );
        },
        tokenize: function (e, t, n) {
          let r,
            i,
            o = this,
            s = o.events.length;
          for (; s--;)
            if (
              ("labelImage" === o.events[s][1].type ||
                "labelLink" === o.events[s][1].type) &&
              !o.events[s][1]._balanced
            ) {
              r = o.events[s][1];
              break;
            }
          return function (t) {
            return r
              ? r._inactive
                ? l(t)
                : ((i = o.parser.defined.includes(
                    et(o.sliceSerialize({ start: r.end, end: o.now() })),
                  )),
                  e.enter("labelEnd"),
                  e.enter("labelMarker"),
                  e.consume(t),
                  e.exit("labelMarker"),
                  e.exit("labelEnd"),
                  a)
              : n(t);
          };
          function a(t) {
            return 40 === t
              ? e.attempt(eu, c, i ? c : l)(t)
              : 91 === t
                ? e.attempt(ec, c, i ? u : l)(t)
                : i
                  ? c(t)
                  : l(t);
          }
          function u(t) {
            return e.attempt(el, c, l)(t);
          }
          function c(e) {
            return t(e);
          }
          function l(e) {
            return ((r._balanced = !0), n(e));
          }
        },
      },
      eu = {
        tokenize: function (e, t, n) {
          return function (t) {
            return (
              e.enter("resource"),
              e.enter("resourceMarker"),
              e.consume(t),
              e.exit("resourceMarker"),
              r
            );
          };
          function r(t) {
            return m(t) ? ee(e, i)(t) : i(t);
          }
          function i(t) {
            return 41 === t
              ? c(t)
              : Y(
                  e,
                  o,
                  s,
                  "resourceDestination",
                  "resourceDestinationLiteral",
                  "resourceDestinationLiteralMarker",
                  "resourceDestinationRaw",
                  "resourceDestinationString",
                  32,
                )(t);
          }
          function o(t) {
            return m(t) ? ee(e, a)(t) : c(t);
          }
          function s(e) {
            return n(e);
          }
          function a(t) {
            return 34 === t || 39 === t || 40 === t
              ? X(
                  e,
                  u,
                  n,
                  "resourceTitle",
                  "resourceTitleMarker",
                  "resourceTitleString",
                )(t)
              : c(t);
          }
          function u(t) {
            return m(t) ? ee(e, c)(t) : c(t);
          }
          function c(r) {
            return 41 === r
              ? (e.enter("resourceMarker"),
                e.consume(r),
                e.exit("resourceMarker"),
                e.exit("resource"),
                t)
              : n(r);
          }
        },
      },
      ec = {
        tokenize: function (e, t, n) {
          let r = this;
          return function (t) {
            return J.call(
              r,
              e,
              i,
              o,
              "reference",
              "referenceMarker",
              "referenceString",
            )(t);
          };
          function i(e) {
            return r.parser.defined.includes(
              et(
                r.sliceSerialize(r.events[r.events.length - 1][1]).slice(1, -1),
              ),
            )
              ? t(e)
              : n(e);
          }
          function o(e) {
            return n(e);
          }
        },
      },
      el = {
        tokenize: function (e, t, n) {
          return function (t) {
            return (
              e.enter("reference"),
              e.enter("referenceMarker"),
              e.consume(t),
              e.exit("referenceMarker"),
              r
            );
          };
          function r(r) {
            return 93 === r
              ? (e.enter("referenceMarker"),
                e.consume(r),
                e.exit("referenceMarker"),
                e.exit("reference"),
                t)
              : n(r);
          }
        },
      },
      ef = {
        name: "labelStartImage",
        resolveAll: ea.resolveAll,
        tokenize: function (e, t, n) {
          let r = this;
          return function (t) {
            return (
              e.enter("labelImage"),
              e.enter("labelImageMarker"),
              e.consume(t),
              e.exit("labelImageMarker"),
              i
            );
          };
          function i(t) {
            return 91 === t
              ? (e.enter("labelMarker"),
                e.consume(t),
                e.exit("labelMarker"),
                e.exit("labelImage"),
                o)
              : n(t);
          }
          function o(e) {
            return 94 === e && "_hiddenFootnoteSupport" in r.parser.constructs
              ? n(e)
              : t(e);
          }
        },
      },
      eh = {
        name: "labelStartLink",
        resolveAll: ea.resolveAll,
        tokenize: function (e, t, n) {
          let r = this;
          return function (t) {
            return (
              e.enter("labelLink"),
              e.enter("labelMarker"),
              e.consume(t),
              e.exit("labelMarker"),
              e.exit("labelLink"),
              i
            );
          };
          function i(e) {
            return 94 === e && "_hiddenFootnoteSupport" in r.parser.constructs
              ? n(e)
              : t(e);
          }
        },
      },
      ed = {
        name: "lineEnding",
        tokenize: function (e, t) {
          return function (n) {
            return (
              e.enter("lineEnding"),
              e.consume(n),
              e.exit("lineEnding"),
              b(e, t, "linePrefix")
            );
          };
        },
      },
      ep = {
        name: "thematicBreak",
        tokenize: function (e, t, n) {
          let r,
            i = 0;
          return function (o) {
            var s;
            return (
              e.enter("thematicBreak"),
              (r = s = o),
              (function o(s) {
                return s === r
                  ? (e.enter("thematicBreakSequence"),
                    (function t(n) {
                      return n === r
                        ? (e.consume(n), i++, t)
                        : (e.exit("thematicBreakSequence"),
                          y(n) ? b(e, o, "whitespace")(n) : o(n));
                    })(s))
                  : i >= 3 && (null === s || g(s))
                    ? (e.exit("thematicBreak"), t(s))
                    : n(s);
              })(s)
            );
          };
        },
      },
      eg = {
        continuation: {
          tokenize: function (e, t, n) {
            let r = this;
            return (
              (r.containerState._closeFlow = void 0),
              e.check(
                P,
                function (n) {
                  return (
                    (r.containerState.furtherBlankLines =
                      r.containerState.furtherBlankLines ||
                      r.containerState.initialBlankLine),
                    b(e, t, "listItemIndent", r.containerState.size + 1)(n)
                  );
                },
                function (n) {
                  return r.containerState.furtherBlankLines || !y(n)
                    ? ((r.containerState.furtherBlankLines = void 0),
                      (r.containerState.initialBlankLine = void 0),
                      i(n))
                    : ((r.containerState.furtherBlankLines = void 0),
                      (r.containerState.initialBlankLine = void 0),
                      e.attempt(ey, t, i)(n));
                },
              )
            );
            function i(i) {
              return (
                (r.containerState._closeFlow = !0),
                (r.interrupt = void 0),
                b(
                  e,
                  e.attempt(eg, t, n),
                  "linePrefix",
                  r.parser.constructs.disable.null.includes("codeIndented")
                    ? void 0
                    : 4,
                )(i)
              );
            }
          },
        },
        exit: function (e) {
          e.exit(this.containerState.type);
        },
        name: "list",
        tokenize: function (e, t, n) {
          let r = this,
            i = r.events[r.events.length - 1],
            o =
              i && "linePrefix" === i[1].type
                ? i[2].sliceSerialize(i[1], !0).length
                : 0,
            s = 0;
          return function (t) {
            let i =
              r.containerState.type ||
              (42 === t || 43 === t || 45 === t
                ? "listUnordered"
                : "listOrdered");
            if (
              "listUnordered" === i
                ? !r.containerState.marker || t === r.containerState.marker
                : h(t)
            ) {
              if (
                (r.containerState.type ||
                  ((r.containerState.type = i), e.enter(i, { _container: !0 })),
                "listUnordered" === i)
              )
                return (
                  e.enter("listItemPrefix"),
                  42 === t || 45 === t ? e.check(ep, n, a)(t) : a(t)
                );
              if (!r.interrupt || 49 === t)
                return (
                  e.enter("listItemPrefix"),
                  e.enter("listItemValue"),
                  (function t(i) {
                    return h(i) && ++s < 10
                      ? (e.consume(i), t)
                      : (!r.interrupt || s < 2) &&
                          (r.containerState.marker
                            ? i === r.containerState.marker
                            : 41 === i || 46 === i)
                        ? (e.exit("listItemValue"), a(i))
                        : n(i);
                  })(t)
                );
            }
            return n(t);
          };
          function a(t) {
            return (
              e.enter("listItemMarker"),
              e.consume(t),
              e.exit("listItemMarker"),
              (r.containerState.marker = r.containerState.marker || t),
              e.check(P, r.interrupt ? n : u, e.attempt(em, l, c))
            );
          }
          function u(e) {
            return ((r.containerState.initialBlankLine = !0), o++, l(e));
          }
          function c(t) {
            return y(t)
              ? (e.enter("listItemPrefixWhitespace"),
                e.consume(t),
                e.exit("listItemPrefixWhitespace"),
                l)
              : n(t);
          }
          function l(n) {
            return (
              (r.containerState.size =
                o + r.sliceSerialize(e.exit("listItemPrefix"), !0).length),
              t(n)
            );
          }
        },
      },
      em = {
        partial: !0,
        tokenize: function (e, t, n) {
          let r = this;
          return b(
            e,
            function (e) {
              let i = r.events[r.events.length - 1];
              return !y(e) && i && "listItemPrefixWhitespace" === i[1].type
                ? t(e)
                : n(e);
            },
            "listItemPrefixWhitespace",
            r.parser.constructs.disable.null.includes("codeIndented")
              ? void 0
              : 5,
          );
        },
      },
      ey = {
        partial: !0,
        tokenize: function (e, t, n) {
          let r = this;
          return b(
            e,
            function (e) {
              let i = r.events[r.events.length - 1];
              return i &&
                "listItemIndent" === i[1].type &&
                i[2].sliceSerialize(i[1], !0).length === r.containerState.size
                ? t(e)
                : n(e);
            },
            "listItemIndent",
            r.containerState.size + 1,
          );
        },
      },
      ek = {
        name: "setextUnderline",
        resolveTo: function (e, t) {
          let n,
            r,
            i,
            o = e.length;
          for (; o--;)
            if ("enter" === e[o][0]) {
              if ("content" === e[o][1].type) {
                n = o;
                break;
              }
              "paragraph" === e[o][1].type && (r = o);
            } else
              ("content" === e[o][1].type && e.splice(o, 1),
                i || "definition" !== e[o][1].type || (i = o));
          let s = {
            type: "setextHeading",
            start: { ...e[n][1].start },
            end: { ...e[e.length - 1][1].end },
          };
          return (
            (e[r][1].type = "setextHeadingText"),
            i
              ? (e.splice(r, 0, ["enter", s, t]),
                e.splice(i + 1, 0, ["exit", e[n][1], t]),
                (e[n][1].end = { ...e[i][1].end }))
              : (e[n][1] = s),
            e.push(["exit", s, t]),
            e
          );
        },
        tokenize: function (e, t, n) {
          let r,
            i = this;
          return function (t) {
            var s;
            let a,
              u = i.events.length;
            for (; u--;)
              if (
                "lineEnding" !== i.events[u][1].type &&
                "linePrefix" !== i.events[u][1].type &&
                "content" !== i.events[u][1].type
              ) {
                a = "paragraph" === i.events[u][1].type;
                break;
              }
            return !i.parser.lazy[i.now().line] && (i.interrupt || a)
              ? (e.enter("setextHeadingLine"),
                (r = t),
                (s = t),
                e.enter("setextHeadingLineSequence"),
                (function t(n) {
                  return n === r
                    ? (e.consume(n), t)
                    : (e.exit("setextHeadingLineSequence"),
                      y(n) ? b(e, o, "lineSuffix")(n) : o(n));
                })(s))
              : n(t);
          };
          function o(r) {
            return null === r || g(r)
              ? (e.exit("setextHeadingLine"), t(r))
              : n(r);
          }
        },
      };
    e.s(
      [
        "attentionMarkers",
        0,
        { null: [42, 95] },
        "contentInitial",
        0,
        {
          91: {
            name: "definition",
            tokenize: function (e, t, n) {
              let r,
                i = this;
              return function (t) {
                var r;
                return (
                  e.enter("definition"),
                  (r = t),
                  J.call(
                    i,
                    e,
                    o,
                    n,
                    "definitionLabel",
                    "definitionLabelMarker",
                    "definitionLabelString",
                  )(r)
                );
              };
              function o(t) {
                return ((r = et(
                  i
                    .sliceSerialize(i.events[i.events.length - 1][1])
                    .slice(1, -1),
                )),
                58 === t)
                  ? (e.enter("definitionMarker"),
                    e.consume(t),
                    e.exit("definitionMarker"),
                    s)
                  : n(t);
              }
              function s(t) {
                return m(t) ? ee(e, a)(t) : a(t);
              }
              function a(t) {
                return Y(
                  e,
                  u,
                  n,
                  "definitionDestination",
                  "definitionDestinationLiteral",
                  "definitionDestinationLiteralMarker",
                  "definitionDestinationRaw",
                  "definitionDestinationString",
                )(t);
              }
              function u(t) {
                return e.attempt(en, c, c)(t);
              }
              function c(t) {
                return y(t) ? b(e, l, "whitespace")(t) : l(t);
              }
              function l(o) {
                return null === o || g(o)
                  ? (e.exit("definition"), i.parser.defined.push(r), t(o))
                  : n(o);
              }
            },
          },
        },
        "disable",
        0,
        { null: [] },
        "document",
        0,
        {
          42: eg,
          43: eg,
          45: eg,
          48: eg,
          49: eg,
          50: eg,
          51: eg,
          52: eg,
          53: eg,
          54: eg,
          55: eg,
          56: eg,
          57: eg,
          62: W,
        },
        "flow",
        0,
        {
          35: {
            name: "headingAtx",
            resolve: function (e, t) {
              let n,
                r,
                i = e.length - 2,
                s = 3;
              return (
                "whitespace" === e[3][1].type && (s += 2),
                i - 2 > s && "whitespace" === e[i][1].type && (i -= 2),
                "atxHeadingSequence" === e[i][1].type &&
                  (s === i - 1 ||
                    (i - 4 > s && "whitespace" === e[i - 2][1].type)) &&
                  (i -= s + 1 === i ? 2 : 4),
                i > s &&
                  ((n = {
                    type: "atxHeadingText",
                    start: e[s][1].start,
                    end: e[i][1].end,
                  }),
                  (r = {
                    type: "chunkText",
                    start: e[s][1].start,
                    end: e[i][1].end,
                    contentType: "text",
                  }),
                  o(e, s, i - s + 1, [
                    ["enter", n, t],
                    ["enter", r, t],
                    ["exit", r, t],
                    ["exit", n, t],
                  ])),
                e
              );
            },
            tokenize: function (e, t, n) {
              let r = 0;
              return function (i) {
                var o;
                return (
                  e.enter("atxHeading"),
                  (o = i),
                  e.enter("atxHeadingSequence"),
                  (function i(o) {
                    return 35 === o && r++ < 6
                      ? (e.consume(o), i)
                      : null === o || m(o)
                        ? (e.exit("atxHeadingSequence"),
                          (function n(r) {
                            return 35 === r
                              ? (e.enter("atxHeadingSequence"),
                                (function t(r) {
                                  return 35 === r
                                    ? (e.consume(r), t)
                                    : (e.exit("atxHeadingSequence"), n(r));
                                })(r))
                              : null === r || g(r)
                                ? (e.exit("atxHeading"), t(r))
                                : y(r)
                                  ? b(e, n, "whitespace")(r)
                                  : (e.enter("atxHeadingText"),
                                    (function t(r) {
                                      return null === r || 35 === r || m(r)
                                        ? (e.exit("atxHeadingText"), n(r))
                                        : (e.consume(r), t);
                                    })(r));
                          })(o))
                        : n(o);
                  })(o)
                );
              };
            },
          },
          42: ep,
          45: [ek, ep],
          60: {
            concrete: !0,
            name: "htmlFlow",
            resolveTo: function (e) {
              let t = e.length;
              for (
                ;
                t-- && ("enter" !== e[t][0] || "htmlFlow" !== e[t][1].type);
              );
              return (
                t > 1 &&
                  "linePrefix" === e[t - 2][1].type &&
                  ((e[t][1].start = e[t - 2][1].start),
                  (e[t + 1][1].start = e[t - 2][1].start),
                  e.splice(t - 2, 2)),
                e
              );
            },
            tokenize: function (e, t, n) {
              let r,
                i,
                o,
                s,
                a,
                l = this;
              return function (t) {
                var n;
                return (
                  (n = t),
                  e.enter("htmlFlow"),
                  e.enter("htmlFlowData"),
                  e.consume(n),
                  f
                );
              };
              function f(s) {
                return 33 === s
                  ? (e.consume(s), h)
                  : 47 === s
                    ? (e.consume(s), (i = !0), k)
                    : 63 === s
                      ? (e.consume(s), (r = 3), l.interrupt ? t : R)
                      : u(s)
                        ? (e.consume(s), (o = String.fromCharCode(s)), x)
                        : n(s);
              }
              function h(i) {
                return 45 === i
                  ? (e.consume(i), (r = 2), d)
                  : 91 === i
                    ? (e.consume(i), (r = 5), (s = 0), p)
                    : u(i)
                      ? (e.consume(i), (r = 4), l.interrupt ? t : R)
                      : n(i);
              }
              function d(r) {
                return 45 === r ? (e.consume(r), l.interrupt ? t : R) : n(r);
              }
              function p(r) {
                let i = "CDATA[";
                return r === i.charCodeAt(s++)
                  ? (e.consume(r), s === i.length)
                    ? l.interrupt
                      ? t
                      : A
                    : p
                  : n(r);
              }
              function k(t) {
                return u(t)
                  ? (e.consume(t), (o = String.fromCharCode(t)), x)
                  : n(t);
              }
              function x(s) {
                if (null === s || 47 === s || 62 === s || m(s)) {
                  let a = 47 === s,
                    u = o.toLowerCase();
                  return !a && !i && ei.includes(u)
                    ? ((r = 1), l.interrupt ? t(s) : A(s))
                    : er.includes(o.toLowerCase())
                      ? ((r = 6), a)
                        ? (e.consume(s), v)
                        : l.interrupt
                          ? t(s)
                          : A(s)
                      : ((r = 7),
                        l.interrupt && !l.parser.lazy[l.now().line]
                          ? n(s)
                          : i
                            ? (function t(n) {
                                return y(n) ? (e.consume(n), t) : E(n);
                              })(s)
                            : b(s));
                }
                return 45 === s || c(s)
                  ? (e.consume(s), (o += String.fromCharCode(s)), x)
                  : n(s);
              }
              function v(r) {
                return 62 === r ? (e.consume(r), l.interrupt ? t : A) : n(r);
              }
              function b(t) {
                return 47 === t
                  ? (e.consume(t), E)
                  : 58 === t || 95 === t || u(t)
                    ? (e.consume(t), w)
                    : y(t)
                      ? (e.consume(t), b)
                      : E(t);
              }
              function w(t) {
                return 45 === t || 46 === t || 58 === t || 95 === t || c(t)
                  ? (e.consume(t), w)
                  : S(t);
              }
              function S(t) {
                return 61 === t
                  ? (e.consume(t), T)
                  : y(t)
                    ? (e.consume(t), S)
                    : b(t);
              }
              function T(t) {
                return null === t ||
                  60 === t ||
                  61 === t ||
                  62 === t ||
                  96 === t
                  ? n(t)
                  : 34 === t || 39 === t
                    ? (e.consume(t), (a = t), P)
                    : y(t)
                      ? (e.consume(t), T)
                      : (function t(n) {
                          return null === n ||
                            34 === n ||
                            39 === n ||
                            47 === n ||
                            60 === n ||
                            61 === n ||
                            62 === n ||
                            96 === n ||
                            m(n)
                            ? S(n)
                            : (e.consume(n), t);
                        })(t);
              }
              function P(t) {
                return t === a
                  ? (e.consume(t), (a = null), I)
                  : null === t || g(t)
                    ? n(t)
                    : (e.consume(t), P);
              }
              function I(e) {
                return 47 === e || 62 === e || y(e) ? b(e) : n(e);
              }
              function E(t) {
                return 62 === t ? (e.consume(t), z) : n(t);
              }
              function z(t) {
                return null === t || g(t)
                  ? A(t)
                  : y(t)
                    ? (e.consume(t), z)
                    : n(t);
              }
              function A(t) {
                return 45 === t && 2 === r
                  ? (e.consume(t), M)
                  : 60 === t && 1 === r
                    ? (e.consume(t), L)
                    : 62 === t && 4 === r
                      ? (e.consume(t), O)
                      : 63 === t && 3 === r
                        ? (e.consume(t), R)
                        : 93 === t && 5 === r
                          ? (e.consume(t), j)
                          : g(t) && (6 === r || 7 === r)
                            ? (e.exit("htmlFlowData"), e.check(eo, B, C)(t))
                            : null === t || g(t)
                              ? (e.exit("htmlFlowData"), C(t))
                              : (e.consume(t), A);
              }
              function C(t) {
                return e.check(es, F, B)(t);
              }
              function F(t) {
                return (
                  e.enter("lineEnding"),
                  e.consume(t),
                  e.exit("lineEnding"),
                  _
                );
              }
              function _(t) {
                return null === t || g(t)
                  ? C(t)
                  : (e.enter("htmlFlowData"), A(t));
              }
              function M(t) {
                return 45 === t ? (e.consume(t), R) : A(t);
              }
              function L(t) {
                return 47 === t ? (e.consume(t), (o = ""), D) : A(t);
              }
              function D(t) {
                if (62 === t) {
                  let n = o.toLowerCase();
                  return ei.includes(n) ? (e.consume(t), O) : A(t);
                }
                return u(t) && o.length < 8
                  ? (e.consume(t), (o += String.fromCharCode(t)), D)
                  : A(t);
              }
              function j(t) {
                return 93 === t ? (e.consume(t), R) : A(t);
              }
              function R(t) {
                return 62 === t
                  ? (e.consume(t), O)
                  : 45 === t && 2 === r
                    ? (e.consume(t), R)
                    : A(t);
              }
              function O(t) {
                return null === t || g(t)
                  ? (e.exit("htmlFlowData"), B(t))
                  : (e.consume(t), O);
              }
              function B(n) {
                return (e.exit("htmlFlow"), t(n));
              }
            },
          },
          61: ek,
          95: ep,
          96: $,
          126: $,
        },
        "flowInitial",
        0,
        { [-2]: Z, [-1]: Z, 32: Z },
        "insideSpan",
        0,
        { null: [H, _] },
        "string",
        0,
        { 38: Q, 92: q },
        "text",
        0,
        {
          [-5]: ed,
          [-4]: ed,
          [-3]: ed,
          33: ef,
          38: Q,
          42: H,
          60: [
            {
              name: "autolink",
              tokenize: function (e, t, n) {
                let r = 0;
                return function (t) {
                  return (
                    e.enter("autolink"),
                    e.enter("autolinkMarker"),
                    e.consume(t),
                    e.exit("autolinkMarker"),
                    e.enter("autolinkProtocol"),
                    i
                  );
                };
                function i(t) {
                  return u(t) ? (e.consume(t), o) : 64 === t ? n(t) : a(t);
                }
                function o(t) {
                  return 43 === t || 45 === t || 46 === t || c(t)
                    ? ((r = 1),
                      (function t(n) {
                        return 58 === n
                          ? (e.consume(n), (r = 0), s)
                          : (43 === n || 45 === n || 46 === n || c(n)) &&
                              r++ < 32
                            ? (e.consume(n), t)
                            : ((r = 0), a(n));
                      })(t))
                    : a(t);
                }
                function s(r) {
                  return 62 === r
                    ? (e.exit("autolinkProtocol"),
                      e.enter("autolinkMarker"),
                      e.consume(r),
                      e.exit("autolinkMarker"),
                      e.exit("autolink"),
                      t)
                    : null === r || 32 === r || 60 === r || f(r)
                      ? n(r)
                      : (e.consume(r), s);
                }
                function a(t) {
                  return 64 === t
                    ? (e.consume(t), h)
                    : l(t)
                      ? (e.consume(t), a)
                      : n(t);
                }
                function h(i) {
                  return c(i)
                    ? (function i(o) {
                        return 46 === o
                          ? (e.consume(o), (r = 0), h)
                          : 62 === o
                            ? ((e.exit("autolinkProtocol").type =
                                "autolinkEmail"),
                              e.enter("autolinkMarker"),
                              e.consume(o),
                              e.exit("autolinkMarker"),
                              e.exit("autolink"),
                              t)
                            : (function t(o) {
                                if ((45 === o || c(o)) && r++ < 63) {
                                  let n = 45 === o ? t : i;
                                  return (e.consume(o), n);
                                }
                                return n(o);
                              })(o);
                      })(i)
                    : n(i);
                }
              },
            },
            {
              name: "htmlText",
              tokenize: function (e, t, n) {
                let r,
                  i,
                  o,
                  s = this;
                return function (t) {
                  return (
                    e.enter("htmlText"),
                    e.enter("htmlTextData"),
                    e.consume(t),
                    a
                  );
                };
                function a(t) {
                  return 33 === t
                    ? (e.consume(t), l)
                    : 47 === t
                      ? (e.consume(t), I)
                      : 63 === t
                        ? (e.consume(t), T)
                        : u(t)
                          ? (e.consume(t), z)
                          : n(t);
                }
                function l(t) {
                  return 45 === t
                    ? (e.consume(t), f)
                    : 91 === t
                      ? (e.consume(t), (i = 0), k)
                      : u(t)
                        ? (e.consume(t), S)
                        : n(t);
                }
                function f(t) {
                  return 45 === t ? (e.consume(t), p) : n(t);
                }
                function h(t) {
                  return null === t
                    ? n(t)
                    : 45 === t
                      ? (e.consume(t), d)
                      : g(t)
                        ? ((o = h), j(t))
                        : (e.consume(t), h);
                }
                function d(t) {
                  return 45 === t ? (e.consume(t), p) : h(t);
                }
                function p(e) {
                  return 62 === e ? D(e) : 45 === e ? d(e) : h(e);
                }
                function k(t) {
                  let r = "CDATA[";
                  return t === r.charCodeAt(i++)
                    ? (e.consume(t), i === r.length ? x : k)
                    : n(t);
                }
                function x(t) {
                  return null === t
                    ? n(t)
                    : 93 === t
                      ? (e.consume(t), v)
                      : g(t)
                        ? ((o = x), j(t))
                        : (e.consume(t), x);
                }
                function v(t) {
                  return 93 === t ? (e.consume(t), w) : x(t);
                }
                function w(t) {
                  return 62 === t ? D(t) : 93 === t ? (e.consume(t), w) : x(t);
                }
                function S(t) {
                  return null === t || 62 === t
                    ? D(t)
                    : g(t)
                      ? ((o = S), j(t))
                      : (e.consume(t), S);
                }
                function T(t) {
                  return null === t
                    ? n(t)
                    : 63 === t
                      ? (e.consume(t), P)
                      : g(t)
                        ? ((o = T), j(t))
                        : (e.consume(t), T);
                }
                function P(e) {
                  return 62 === e ? D(e) : T(e);
                }
                function I(t) {
                  return u(t) ? (e.consume(t), E) : n(t);
                }
                function E(t) {
                  return 45 === t || c(t)
                    ? (e.consume(t), E)
                    : (function t(n) {
                        return g(n)
                          ? ((o = t), j(n))
                          : y(n)
                            ? (e.consume(n), t)
                            : D(n);
                      })(t);
                }
                function z(t) {
                  return 45 === t || c(t)
                    ? (e.consume(t), z)
                    : 47 === t || 62 === t || m(t)
                      ? A(t)
                      : n(t);
                }
                function A(t) {
                  return 47 === t
                    ? (e.consume(t), D)
                    : 58 === t || 95 === t || u(t)
                      ? (e.consume(t), C)
                      : g(t)
                        ? ((o = A), j(t))
                        : y(t)
                          ? (e.consume(t), A)
                          : D(t);
                }
                function C(t) {
                  return 45 === t || 46 === t || 58 === t || 95 === t || c(t)
                    ? (e.consume(t), C)
                    : (function t(n) {
                        return 61 === n
                          ? (e.consume(n), F)
                          : g(n)
                            ? ((o = t), j(n))
                            : y(n)
                              ? (e.consume(n), t)
                              : A(n);
                      })(t);
                }
                function F(t) {
                  return null === t ||
                    60 === t ||
                    61 === t ||
                    62 === t ||
                    96 === t
                    ? n(t)
                    : 34 === t || 39 === t
                      ? (e.consume(t), (r = t), _)
                      : g(t)
                        ? ((o = F), j(t))
                        : y(t)
                          ? (e.consume(t), F)
                          : (e.consume(t), M);
                }
                function _(t) {
                  return t === r
                    ? (e.consume(t), (r = void 0), L)
                    : null === t
                      ? n(t)
                      : g(t)
                        ? ((o = _), j(t))
                        : (e.consume(t), _);
                }
                function M(t) {
                  return null === t ||
                    34 === t ||
                    39 === t ||
                    60 === t ||
                    61 === t ||
                    96 === t
                    ? n(t)
                    : 47 === t || 62 === t || m(t)
                      ? A(t)
                      : (e.consume(t), M);
                }
                function L(e) {
                  return 47 === e || 62 === e || m(e) ? A(e) : n(e);
                }
                function D(r) {
                  return 62 === r
                    ? (e.consume(r),
                      e.exit("htmlTextData"),
                      e.exit("htmlText"),
                      t)
                    : n(r);
                }
                function j(t) {
                  return (
                    e.exit("htmlTextData"),
                    e.enter("lineEnding"),
                    e.consume(t),
                    e.exit("lineEnding"),
                    R
                  );
                }
                function R(t) {
                  return y(t)
                    ? b(
                        e,
                        O,
                        "linePrefix",
                        s.parser.constructs.disable.null.includes(
                          "codeIndented",
                        )
                          ? void 0
                          : 4,
                      )(t)
                    : O(t);
                }
                function O(t) {
                  return (e.enter("htmlTextData"), o(t));
                }
              },
            },
          ],
          91: eh,
          92: [
            {
              name: "hardBreakEscape",
              tokenize: function (e, t, n) {
                return function (t) {
                  return (e.enter("hardBreakEscape"), e.consume(t), r);
                };
                function r(r) {
                  return g(r) ? (e.exit("hardBreakEscape"), t(r)) : n(r);
                }
              },
            },
            q,
          ],
          93: ea,
          95: H,
          96: {
            name: "codeText",
            previous: function (e) {
              return (
                96 !== e ||
                "characterEscape" ===
                  this.events[this.events.length - 1][1].type
              );
            },
            resolve: function (e) {
              let t,
                n,
                r = e.length - 4,
                i = 3;
              if (
                ("lineEnding" === e[3][1].type || "space" === e[i][1].type) &&
                ("lineEnding" === e[r][1].type || "space" === e[r][1].type)
              ) {
                for (t = i; ++t < r;)
                  if ("codeTextData" === e[t][1].type) {
                    ((e[i][1].type = "codeTextPadding"),
                      (e[r][1].type = "codeTextPadding"),
                      (i += 2),
                      (r -= 2));
                    break;
                  }
              }
              for (t = i - 1, r++; ++t <= r;)
                void 0 === n
                  ? t !== r && "lineEnding" !== e[t][1].type && (n = t)
                  : (t === r || "lineEnding" === e[t][1].type) &&
                    ((e[n][1].type = "codeTextData"),
                    t !== n + 2 &&
                      ((e[n][1].end = e[t - 1][1].end),
                      e.splice(n + 2, t - n - 2),
                      (r -= t - n - 2),
                      (t = n + 2)),
                    (n = void 0));
              return e;
            },
            tokenize: function (e, t, n) {
              let r,
                i,
                o = 0;
              return function (t) {
                return (
                  e.enter("codeText"),
                  e.enter("codeTextSequence"),
                  (function t(n) {
                    return 96 === n
                      ? (e.consume(n), o++, t)
                      : (e.exit("codeTextSequence"), s(n));
                  })(t)
                );
              };
              function s(u) {
                return null === u
                  ? n(u)
                  : 32 === u
                    ? (e.enter("space"), e.consume(u), e.exit("space"), s)
                    : 96 === u
                      ? ((i = e.enter("codeTextSequence")),
                        (r = 0),
                        (function n(s) {
                          return 96 === s
                            ? (e.consume(s), r++, n)
                            : r === o
                              ? (e.exit("codeTextSequence"),
                                e.exit("codeText"),
                                t(s))
                              : ((i.type = "codeTextData"), a(s));
                        })(u))
                      : g(u)
                        ? (e.enter("lineEnding"),
                          e.consume(u),
                          e.exit("lineEnding"),
                          s)
                        : (e.enter("codeTextData"), a(u));
              }
              function a(t) {
                return null === t || 32 === t || 96 === t || g(t)
                  ? (e.exit("codeTextData"), s(t))
                  : (e.consume(t), a);
              }
            },
          },
        },
      ],
      19210,
    );
    var ex = e.i(19210);
    let ev = /[\0\t\n\r]/g;
    function eb(e, t) {
      let n = Number.parseInt(e, t);
      return n < 9 ||
        11 === n ||
        (n > 13 && n < 32) ||
        (n > 126 && n < 160) ||
        (n > 55295 && n < 57344) ||
        (n > 64975 && n < 65008) ||
        (65535 & n) == 65535 ||
        (65535 & n) == 65534 ||
        n > 1114111
        ? "�"
        : String.fromCodePoint(n);
    }
    let ew =
      /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;
    function eS(e, t, n) {
      if (t) return t;
      if (35 === n.charCodeAt(0)) {
        let e = n.charCodeAt(1),
          t = 120 === e || 88 === e;
        return eb(n.slice(t ? 2 : 1), t ? 16 : 10);
      }
      return N(n) || e;
    }
    function eT(e) {
      return e && "object" == typeof e
        ? "position" in e || "type" in e
          ? eI(e.position)
          : "start" in e || "end" in e
            ? eI(e)
            : "line" in e || "column" in e
              ? eP(e)
              : ""
        : "";
    }
    function eP(e) {
      return eE(e && e.line) + ":" + eE(e && e.column);
    }
    function eI(e) {
      return eP(e && e.start) + "-" + eP(e && e.end);
    }
    function eE(e) {
      return e && "number" == typeof e ? e : 1;
    }
    let ez = {}.hasOwnProperty;
    function eA(e) {
      return { line: e.line, column: e.column, offset: e.offset };
    }
    function eC(e, t) {
      if (e)
        throw Error(
          "Cannot close `" +
            e.type +
            "` (" +
            eT({ start: e.start, end: e.end }) +
            "): a different token (`" +
            t.type +
            "`, " +
            eT({ start: t.start, end: t.end }) +
            ") is open",
        );
      throw Error(
        "Cannot close document, a token (`" +
          t.type +
          "`, " +
          eT({ start: t.start, end: t.end }) +
          ") is still open",
      );
    }
    function eF(e) {
      if (e) throw e;
    }
    var e_ = e.i(75609);
    function eM() {}
    function eL(e) {
      if ("object" != typeof e || null === e) return !1;
      let t = Object.getPrototypeOf(e);
      return (
        (null === t ||
          t === Object.prototype ||
          null === Object.getPrototypeOf(t)) &&
        !(Symbol.toStringTag in e) &&
        !(Symbol.iterator in e)
      );
    }
    class eD extends Error {
      constructor(e, t, n) {
        (super(), "string" == typeof t && ((n = t), (t = void 0)));
        let r = "",
          i = {},
          o = !1;
        if (
          (t &&
            (i =
              ("line" in t && "column" in t) || ("start" in t && "end" in t)
                ? { place: t }
                : "type" in t
                  ? { ancestors: [t], place: t.position }
                  : { ...t }),
          "string" == typeof e
            ? (r = e)
            : !i.cause && e && ((o = !0), (r = e.message), (i.cause = e)),
          !i.ruleId && !i.source && "string" == typeof n)
        ) {
          const e = n.indexOf(":");
          -1 === e
            ? (i.ruleId = n)
            : ((i.source = n.slice(0, e)), (i.ruleId = n.slice(e + 1)));
        }
        if (!i.place && i.ancestors && i.ancestors) {
          const e = i.ancestors[i.ancestors.length - 1];
          e && (i.place = e.position);
        }
        const s = i.place && "start" in i.place ? i.place.start : i.place;
        ((this.ancestors = i.ancestors || void 0),
          (this.cause = i.cause || void 0),
          (this.column = s ? s.column : void 0),
          (this.fatal = void 0),
          (this.file = ""),
          (this.message = r),
          (this.line = s ? s.line : void 0),
          (this.name = eT(i.place) || "1:1"),
          (this.place = i.place || void 0),
          (this.reason = this.message),
          (this.ruleId = i.ruleId || void 0),
          (this.source = i.source || void 0),
          (this.stack =
            o && i.cause && "string" == typeof i.cause.stack
              ? i.cause.stack
              : ""),
          (this.actual = void 0),
          (this.expected = void 0),
          (this.note = void 0),
          (this.url = void 0));
      }
    }
    ((eD.prototype.file = ""),
      (eD.prototype.name = ""),
      (eD.prototype.reason = ""),
      (eD.prototype.message = ""),
      (eD.prototype.stack = ""),
      (eD.prototype.column = void 0),
      (eD.prototype.line = void 0),
      (eD.prototype.ancestors = void 0),
      (eD.prototype.cause = void 0),
      (eD.prototype.fatal = void 0),
      (eD.prototype.place = void 0),
      (eD.prototype.ruleId = void 0),
      (eD.prototype.source = void 0));
    let ej = function (e, t) {
        let n;
        if (void 0 !== t && "string" != typeof t)
          throw TypeError('"ext" argument must be a string');
        eH(e);
        let r = 0,
          i = -1,
          o = e.length;
        if (void 0 === t || 0 === t.length || t.length > e.length) {
          for (; o--;)
            if (47 === e.codePointAt(o)) {
              if (n) {
                r = o + 1;
                break;
              }
            } else i < 0 && ((n = !0), (i = o + 1));
          return i < 0 ? "" : e.slice(r, i);
        }
        if (t === e) return "";
        let s = -1,
          a = t.length - 1;
        for (; o--;)
          if (47 === e.codePointAt(o)) {
            if (n) {
              r = o + 1;
              break;
            }
          } else
            (s < 0 && ((n = !0), (s = o + 1)),
              a > -1 &&
                (e.codePointAt(o) === t.codePointAt(a--)
                  ? a < 0 && (i = o)
                  : ((a = -1), (i = s))));
        return (r === i ? (i = s) : i < 0 && (i = e.length), e.slice(r, i));
      },
      eR = function (e) {
        let t;
        if ((eH(e), 0 === e.length)) return ".";
        let n = -1,
          r = e.length;
        for (; --r;)
          if (47 === e.codePointAt(r)) {
            if (t) {
              n = r;
              break;
            }
          } else t || (t = !0);
        return n < 0
          ? 47 === e.codePointAt(0)
            ? "/"
            : "."
          : 1 === n && 47 === e.codePointAt(0)
            ? "//"
            : e.slice(0, n);
      },
      eO = function (e) {
        let t;
        eH(e);
        let n = e.length,
          r = -1,
          i = 0,
          o = -1,
          s = 0;
        for (; n--;) {
          let a = e.codePointAt(n);
          if (47 === a) {
            if (t) {
              i = n + 1;
              break;
            }
            continue;
          }
          (r < 0 && ((t = !0), (r = n + 1)),
            46 === a
              ? o < 0
                ? (o = n)
                : 1 !== s && (s = 1)
              : o > -1 && (s = -1));
        }
        return o < 0 ||
          r < 0 ||
          0 === s ||
          (1 === s && o === r - 1 && o === i + 1)
          ? ""
          : e.slice(o, r);
      },
      eB = function (...e) {
        var t;
        let n,
          r,
          i,
          o = -1;
        for (; ++o < e.length;)
          (eH(e[o]), e[o] && (i = void 0 === i ? e[o] : i + "/" + e[o]));
        return void 0 === i
          ? "."
          : (eH((t = i)),
            (n = 47 === t.codePointAt(0)),
            0 !==
              (r = (function (e, t) {
                let n,
                  r,
                  i = "",
                  o = 0,
                  s = -1,
                  a = 0,
                  u = -1;
                for (; ++u <= e.length;) {
                  if (u < e.length) n = e.codePointAt(u);
                  else if (47 === n) break;
                  else n = 47;
                  if (47 === n) {
                    if (s === u - 1 || 1 === a);
                    else if (s !== u - 1 && 2 === a) {
                      if (
                        i.length < 2 ||
                        2 !== o ||
                        46 !== i.codePointAt(i.length - 1) ||
                        46 !== i.codePointAt(i.length - 2)
                      ) {
                        if (i.length > 2) {
                          if ((r = i.lastIndexOf("/")) !== i.length - 1) {
                            (r < 0
                              ? ((i = ""), (o = 0))
                              : (o =
                                  (i = i.slice(0, r)).length -
                                  1 -
                                  i.lastIndexOf("/")),
                              (s = u),
                              (a = 0));
                            continue;
                          }
                        } else if (i.length > 0) {
                          ((i = ""), (o = 0), (s = u), (a = 0));
                          continue;
                        }
                      }
                      t && ((i = i.length > 0 ? i + "/.." : ".."), (o = 2));
                    } else
                      (i.length > 0
                        ? (i += "/" + e.slice(s + 1, u))
                        : (i = e.slice(s + 1, u)),
                        (o = u - s - 1));
                    ((s = u), (a = 0));
                  } else 46 === n && a > -1 ? a++ : (a = -1);
                }
                return i;
              })(t, !n)).length ||
              n ||
              (r = "."),
            r.length > 0 && 47 === t.codePointAt(t.length - 1) && (r += "/"),
            n ? "/" + r : r);
      };
    function eH(e) {
      if ("string" != typeof e)
        throw TypeError("Path must be a string. Received " + JSON.stringify(e));
    }
    function eV(e) {
      return !!(
        null !== e &&
        "object" == typeof e &&
        "href" in e &&
        e.href &&
        "protocol" in e &&
        e.protocol &&
        void 0 === e.auth
      );
    }
    let eW = ["history", "path", "basename", "stem", "extname", "dirname"];
    class eq {
      constructor(e) {
        let t, n;
        ((t = e
          ? eV(e)
            ? { path: e }
            : "string" == typeof e ||
                (function (e) {
                  return !!(
                    e &&
                    "object" == typeof e &&
                    "byteLength" in e &&
                    "byteOffset" in e
                  );
                })(e)
              ? { value: e }
              : e
          : {}),
          (this.cwd = "cwd" in t ? "" : "/"),
          (this.data = {}),
          (this.history = []),
          (this.messages = []),
          this.value,
          this.map,
          this.result,
          this.stored);
        let r = -1;
        for (; ++r < eW.length;) {
          const e = eW[r];
          e in t &&
            void 0 !== t[e] &&
            null !== t[e] &&
            (this[e] = "history" === e ? [...t[e]] : t[e]);
        }
        for (n in t) eW.includes(n) || (this[n] = t[n]);
      }
      get basename() {
        return "string" == typeof this.path ? ej(this.path) : void 0;
      }
      set basename(e) {
        (eN(e, "basename"),
          eU(e, "basename"),
          (this.path = eB(this.dirname || "", e)));
      }
      get dirname() {
        return "string" == typeof this.path ? eR(this.path) : void 0;
      }
      set dirname(e) {
        (eQ(this.basename, "dirname"),
          (this.path = eB(e || "", this.basename)));
      }
      get extname() {
        return "string" == typeof this.path ? eO(this.path) : void 0;
      }
      set extname(e) {
        if ((eU(e, "extname"), eQ(this.dirname, "extname"), e)) {
          if (46 !== e.codePointAt(0))
            throw Error("`extname` must start with `.`");
          if (e.includes(".", 1))
            throw Error("`extname` cannot contain multiple dots");
        }
        this.path = eB(this.dirname, this.stem + (e || ""));
      }
      get path() {
        return this.history[this.history.length - 1];
      }
      set path(e) {
        (eV(e) &&
          (e = (function (e) {
            if ("string" == typeof e) e = new URL(e);
            else if (!eV(e)) {
              let t = TypeError(
                'The "path" argument must be of type string or an instance of URL. Received `' +
                  e +
                  "`",
              );
              throw ((t.code = "ERR_INVALID_ARG_TYPE"), t);
            }
            if ("file:" !== e.protocol) {
              let e = TypeError("The URL must be of scheme file");
              throw ((e.code = "ERR_INVALID_URL_SCHEME"), e);
            }
            return (function (e) {
              if ("" !== e.hostname) {
                let e = TypeError(
                  'File URL host must be "localhost" or empty on darwin',
                );
                throw ((e.code = "ERR_INVALID_FILE_URL_HOST"), e);
              }
              let t = e.pathname,
                n = -1;
              for (; ++n < t.length;)
                if (37 === t.codePointAt(n) && 50 === t.codePointAt(n + 1)) {
                  let e = t.codePointAt(n + 2);
                  if (70 === e || 102 === e) {
                    let e = TypeError(
                      "File URL path must not include encoded / characters",
                    );
                    throw ((e.code = "ERR_INVALID_FILE_URL_PATH"), e);
                  }
                }
              return decodeURIComponent(t);
            })(e);
          })(e)),
          eN(e, "path"),
          this.path !== e && this.history.push(e));
      }
      get stem() {
        return "string" == typeof this.path
          ? ej(this.path, this.extname)
          : void 0;
      }
      set stem(e) {
        (eN(e, "stem"),
          eU(e, "stem"),
          (this.path = eB(this.dirname || "", e + (this.extname || ""))));
      }
      fail(e, t, n) {
        let r = this.message(e, t, n);
        throw ((r.fatal = !0), r);
      }
      info(e, t, n) {
        let r = this.message(e, t, n);
        return ((r.fatal = void 0), r);
      }
      message(e, t, n) {
        let r = new eD(e, t, n);
        return (
          this.path &&
            ((r.name = this.path + ":" + r.name), (r.file = this.path)),
          (r.fatal = !1),
          this.messages.push(r),
          r
        );
      }
      toString(e) {
        return void 0 === this.value
          ? ""
          : "string" == typeof this.value
            ? this.value
            : new TextDecoder(e || void 0).decode(this.value);
      }
    }
    function eU(e, t) {
      if (e && e.includes("/"))
        throw Error("`" + t + "` cannot be a path: did not expect `/`");
    }
    function eN(e, t) {
      if (!e) throw Error("`" + t + "` cannot be empty");
    }
    function eQ(e, t) {
      if (!e) throw Error("Setting `" + t + "` requires `path` to be set too");
    }
    let eG = function (e) {
        let t = this.constructor.prototype,
          n = t[e],
          r = function () {
            return n.apply(r, arguments);
          };
        return (Object.setPrototypeOf(r, t), r);
      },
      e$ = {}.hasOwnProperty;
    class eZ extends eG {
      constructor() {
        (super("copy"),
          (this.Compiler = void 0),
          (this.Parser = void 0),
          (this.attachers = []),
          (this.compiler = void 0),
          (this.freezeIndex = -1),
          (this.frozen = void 0),
          (this.namespace = {}),
          (this.parser = void 0),
          (this.transformers = (function () {
            let e = [],
              t = {
                run: function (...t) {
                  let n = -1,
                    r = t.pop();
                  if ("function" != typeof r)
                    throw TypeError(
                      "Expected function as last argument, not " + r,
                    );
                  !(function i(o, ...s) {
                    let a = e[++n],
                      u = -1;
                    if (o) return void r(o);
                    for (; ++u < t.length;)
                      (null === s[u] || void 0 === s[u]) && (s[u] = t[u]);
                    ((t = s),
                      a
                        ? (function (e, t) {
                            let n;
                            return function (...t) {
                              let o,
                                s = e.length > t.length;
                              s && t.push(r);
                              try {
                                o = e.apply(this, t);
                              } catch (e) {
                                if (s && n) throw e;
                                return r(e);
                              }
                              s ||
                                (o && o.then && "function" == typeof o.then
                                  ? o.then(i, r)
                                  : o instanceof Error
                                    ? r(o)
                                    : i(o));
                            };
                            function r(e, ...i) {
                              n || ((n = !0), t(e, ...i));
                            }
                            function i(e) {
                              r(null, e);
                            }
                          })(
                            a,
                            i,
                          )(...s)
                        : r(null, ...s));
                  })(null, ...t);
                },
                use: function (n) {
                  if ("function" != typeof n)
                    throw TypeError(
                      "Expected `middelware` to be a function, not " + n,
                    );
                  return (e.push(n), t);
                },
              };
            return t;
          })()));
      }
      copy() {
        let e = new eZ(),
          t = -1;
        for (; ++t < this.attachers.length;) {
          let n = this.attachers[t];
          e.use(...n);
        }
        return (e.data((0, e_.default)(!0, {}, this.namespace)), e);
      }
      data(e, t) {
        return "string" == typeof e
          ? 2 == arguments.length
            ? (eX("data", this.frozen), (this.namespace[e] = t), this)
            : (e$.call(this.namespace, e) && this.namespace[e]) || void 0
          : e
            ? (eX("data", this.frozen), (this.namespace = e), this)
            : this.namespace;
      }
      freeze() {
        if (this.frozen) return this;
        for (; ++this.freezeIndex < this.attachers.length;) {
          let [e, ...t] = this.attachers[this.freezeIndex];
          if (!1 === t[0]) continue;
          !0 === t[0] && (t[0] = void 0);
          let n = e.call(this, ...t);
          "function" == typeof n && this.transformers.use(n);
        }
        return ((this.frozen = !0), (this.freezeIndex = 1 / 0), this);
      }
      parse(e) {
        this.freeze();
        let t = e2(e),
          n = this.parser || this.Parser;
        return (eY("parse", n), n(String(t), t));
      }
      process(e, t) {
        let n = this;
        return (
          this.freeze(),
          eY("process", this.parser || this.Parser),
          eJ("process", this.compiler || this.Compiler),
          t ? r(void 0, t) : new Promise(r)
        );
        function r(r, i) {
          let o = e2(e),
            s = n.parse(o);
          function a(e, n) {
            e || !n
              ? i(e)
              : r
                ? r(n)
                : (eM(t, "`done` is defined if `resolve` is not"),
                  t(void 0, n));
          }
          n.run(s, o, function (e, t, r) {
            var i, o;
            if (e || !t || !r) return a(e);
            let s = n.stringify(t, r);
            ("string" == typeof (i = s) ||
            ((o = i) &&
              "object" == typeof o &&
              "byteLength" in o &&
              "byteOffset" in o)
              ? (r.value = s)
              : (r.result = s),
              a(e, r));
          });
        }
      }
      processSync(e) {
        let t,
          n = !1;
        return (
          this.freeze(),
          eY("processSync", this.parser || this.Parser),
          eJ("processSync", this.compiler || this.Compiler),
          this.process(e, function (e, r) {
            ((n = !0), eF(e), (t = r));
          }),
          e1("processSync", "process", n),
          eM(t, "we either bailed on an error or have a tree"),
          t
        );
      }
      run(e, t, n) {
        (e0(e), this.freeze());
        let r = this.transformers;
        return (
          n || "function" != typeof t || ((n = t), (t = void 0)),
          n ? i(void 0, n) : new Promise(i)
        );
        function i(i, o) {
          eM(
            "function" != typeof t,
            "`file` can’t be a `done` anymore, we checked",
          );
          let s = e2(t);
          r.run(e, s, function (t, r, s) {
            let a = r || e;
            t
              ? o(t)
              : i
                ? i(a)
                : (eM(n, "`done` is defined if `resolve` is not"),
                  n(void 0, a, s));
          });
        }
      }
      runSync(e, t) {
        let n,
          r = !1;
        return (
          this.run(e, t, function (e, t) {
            (eF(e), (n = t), (r = !0));
          }),
          e1("runSync", "run", r),
          eM(n, "we either bailed on an error or have a tree"),
          n
        );
      }
      stringify(e, t) {
        this.freeze();
        let n = e2(t),
          r = this.compiler || this.Compiler;
        return (eJ("stringify", r), e0(e), r(e, n));
      }
      use(e, ...t) {
        let n = this.attachers,
          r = this.namespace;
        if ((eX("use", this.frozen), null == e));
        else if ("function" == typeof e) s(e, t);
        else if ("object" == typeof e) Array.isArray(e) ? o(e) : i(e);
        else throw TypeError("Expected usable value, not `" + e + "`");
        return this;
        function i(e) {
          if (!("plugins" in e) && !("settings" in e))
            throw Error(
              "Expected usable value but received an empty preset, which is probably a mistake: presets typically come with `plugins` and sometimes with `settings`, but this has neither",
            );
          (o(e.plugins),
            e.settings &&
              (r.settings = (0, e_.default)(!0, r.settings, e.settings)));
        }
        function o(e) {
          let t = -1;
          if (null == e);
          else if (Array.isArray(e))
            for (; ++t < e.length;)
              !(function (e) {
                if ("function" == typeof e) s(e, []);
                else if ("object" == typeof e)
                  if (Array.isArray(e)) {
                    let [t, ...n] = e;
                    s(t, n);
                  } else i(e);
                else throw TypeError("Expected usable value, not `" + e + "`");
              })(e[t]);
          else throw TypeError("Expected a list of plugins, not `" + e + "`");
        }
        function s(e, t) {
          let r = -1,
            i = -1;
          for (; ++r < n.length;)
            if (n[r][0] === e) {
              i = r;
              break;
            }
          if (-1 === i) n.push([e, ...t]);
          else if (t.length > 0) {
            let [r, ...o] = t,
              s = n[i][1];
            (eL(s) && eL(r) && (r = (0, e_.default)(!0, s, r)),
              (n[i] = [e, r, ...o]));
          }
        }
      }
    }
    let eK = new eZ().freeze();
    function eY(e, t) {
      if ("function" != typeof t)
        throw TypeError("Cannot `" + e + "` without `parser`");
    }
    function eJ(e, t) {
      if ("function" != typeof t)
        throw TypeError("Cannot `" + e + "` without `compiler`");
    }
    function eX(e, t) {
      if (t)
        throw Error(
          "Cannot call `" +
            e +
            "` on a frozen processor.\nCreate a new processor first, by calling it: use `processor()` instead of `processor`.",
        );
    }
    function e0(e) {
      if (!eL(e) || "string" != typeof e.type)
        throw TypeError("Expected node, got `" + e + "`");
    }
    function e1(e, t, n) {
      if (!n)
        throw Error("`" + e + "` finished async. Use `" + t + "` instead");
    }
    function e2(e) {
      var t;
      return (t = e) &&
        "object" == typeof t &&
        "message" in t &&
        "messages" in t
        ? e
        : new eq(e);
    }
    let e4 = function (e) {
      var t, n;
      if (null == e) return e6;
      if ("function" == typeof e) return e3(e);
      if ("object" == typeof e) {
        return Array.isArray(e)
          ? (function (e) {
              let t = [],
                n = -1;
              for (; ++n < e.length;) t[n] = e4(e[n]);
              return e3(function (...e) {
                let n = -1;
                for (; ++n < t.length;) if (t[n].apply(this, e)) return !0;
                return !1;
              });
            })(e)
          : ((t = e),
            e3(function (e) {
              let n;
              for (n in t) if (e[n] !== t[n]) return !1;
              return !0;
            }));
      }
      if ("string" == typeof e) {
        return (
          (n = e),
          e3(function (e) {
            return e && e.type === n;
          })
        );
      }
      throw Error("Expected function, string, or object as test");
    };
    function e3(e) {
      return function (t, n, r) {
        return !!(
          (function (e) {
            return null !== e && "object" == typeof e && "type" in e;
          })(t) &&
          e.call(this, t, "number" == typeof n ? n : void 0, r || void 0)
        );
      };
    }
    function e6() {
      return !0;
    }
    let e5 = [];
    function e9(e, t, n, r) {
      var i, o, s;
      let a, u, c, l, f, h;
      ("function" == typeof t && "function" != typeof n
        ? ((u = void 0), (c = t), (a = n))
        : ((u = t), (c = n), (a = r)),
        (i = u),
        (o = function (e, t) {
          let n = t[t.length - 1],
            r = n ? n.children.indexOf(e) : void 0;
          return c(e, r, n);
        }),
        (s = a),
        "function" == typeof i && "function" != typeof o
          ? ((s = o), (o = i))
          : (l = i),
        (f = e4(l)),
        (h = s ? -1 : 1),
        (function e(t, n, r) {
          let a = t && "object" == typeof t ? t : {};
          if ("string" == typeof a.type) {
            let e =
              "string" == typeof a.tagName
                ? a.tagName
                : "string" == typeof a.name
                  ? a.name
                  : void 0;
            Object.defineProperty(u, "name", {
              value: "node (" + t.type + (e ? "<" + e + ">" : "") + ")",
            });
          }
          return u;
          function u() {
            var a;
            let u,
              c,
              l,
              d = e5;
            if (
              (!i || f(t, n, r[r.length - 1] || void 0)) &&
              !1 ===
                (d = Array.isArray((a = o(t, r)))
                  ? a
                  : "number" == typeof a
                    ? [!0, a]
                    : null == a
                      ? e5
                      : [a])[0]
            )
              return d;
            if ("children" in t && t.children && t.children && "skip" !== d[0])
              for (
                c = (s ? t.children.length : -1) + h, l = r.concat(t);
                c > -1 && c < t.children.length;
              ) {
                if (!1 === (u = e(t.children[c], c, l)())[0]) return u;
                c = "number" == typeof u[1] ? u[1] : c + h;
              }
            return d;
          }
        })(e, void 0, [])());
    }
    let e7 = eK().use(function (e) {
        let t = this;
        t.parser = function (r) {
          var i, u;
          let c, l, f, h;
          return (
            "object" ==
              typeof (i = {
                ...t.data("settings"),
                ...e,
                extensions: t.data("micromarkExtensions") || [],
                mdastExtensions: t.data("fromMarkdownExtensions") || [],
              }) && ((u = i), (i = void 0)),
            (function (e) {
              let t = {
                transforms: [],
                canContainEols: [
                  "emphasis",
                  "fragment",
                  "heading",
                  "paragraph",
                  "strong",
                ],
                enter: {
                  autolink: i(k),
                  autolinkProtocol: l,
                  autolinkEmail: l,
                  atxHeading: i(g),
                  blockQuote: i(function () {
                    return { type: "blockquote", children: [] };
                  }),
                  characterEscape: l,
                  characterReference: l,
                  codeFenced: i(p),
                  codeFencedFenceInfo: o,
                  codeFencedFenceMeta: o,
                  codeIndented: i(p, o),
                  codeText: i(function () {
                    return { type: "inlineCode", value: "" };
                  }, o),
                  codeTextData: l,
                  data: l,
                  codeFlowValue: l,
                  definition: i(function () {
                    return {
                      type: "definition",
                      identifier: "",
                      label: null,
                      title: null,
                      url: "",
                    };
                  }),
                  definitionDestinationString: o,
                  definitionLabelString: o,
                  definitionTitleString: o,
                  emphasis: i(function () {
                    return { type: "emphasis", children: [] };
                  }),
                  hardBreakEscape: i(m),
                  hardBreakTrailing: i(m),
                  htmlFlow: i(y, o),
                  htmlFlowData: l,
                  htmlText: i(y, o),
                  htmlTextData: l,
                  image: i(function () {
                    return { type: "image", title: null, url: "", alt: null };
                  }),
                  label: o,
                  link: i(k),
                  listItem: i(function (e) {
                    return {
                      type: "listItem",
                      spread: e._spread,
                      checked: null,
                      children: [],
                    };
                  }),
                  listItemValue: function (e) {
                    this.data.expectingFirstListItemValue &&
                      ((this.stack[this.stack.length - 2].start =
                        Number.parseInt(this.sliceSerialize(e), 10)),
                      (this.data.expectingFirstListItemValue = void 0));
                  },
                  listOrdered: i(x, function () {
                    this.data.expectingFirstListItemValue = !0;
                  }),
                  listUnordered: i(x),
                  paragraph: i(function () {
                    return { type: "paragraph", children: [] };
                  }),
                  reference: function () {
                    this.data.referenceType = "collapsed";
                  },
                  referenceString: o,
                  resourceDestinationString: o,
                  resourceTitleString: o,
                  setextHeading: i(g),
                  strong: i(function () {
                    return { type: "strong", children: [] };
                  }),
                  thematicBreak: i(function () {
                    return { type: "thematicBreak" };
                  }),
                },
                exit: {
                  atxHeading: a(),
                  atxHeadingSequence: function (e) {
                    let t = this.stack[this.stack.length - 1];
                    t.depth || (t.depth = this.sliceSerialize(e).length);
                  },
                  autolink: a(),
                  autolinkEmail: function (e) {
                    (f.call(this, e),
                      (this.stack[this.stack.length - 1].url =
                        "mailto:" + this.sliceSerialize(e)));
                  },
                  autolinkProtocol: function (e) {
                    (f.call(this, e),
                      (this.stack[this.stack.length - 1].url =
                        this.sliceSerialize(e)));
                  },
                  blockQuote: a(),
                  characterEscapeValue: f,
                  characterReferenceMarkerHexadecimal: d,
                  characterReferenceMarkerNumeric: d,
                  characterReferenceValue: function (e) {
                    let t,
                      n = this.sliceSerialize(e),
                      r = this.data.characterReferenceType;
                    r
                      ? ((t = eb(
                          n,
                          "characterReferenceMarkerNumeric" === r ? 10 : 16,
                        )),
                        (this.data.characterReferenceType = void 0))
                      : (t = N(n));
                    let i = this.stack[this.stack.length - 1];
                    i.value += t;
                  },
                  characterReference: function (e) {
                    this.stack.pop().position.end = eA(e.end);
                  },
                  codeFenced: a(function () {
                    let e = this.resume();
                    ((this.stack[this.stack.length - 1].value = e.replace(
                      /^(\r?\n|\r)|(\r?\n|\r)$/g,
                      "",
                    )),
                      (this.data.flowCodeInside = void 0));
                  }),
                  codeFencedFence: function () {
                    this.data.flowCodeInside ||
                      (this.buffer(), (this.data.flowCodeInside = !0));
                  },
                  codeFencedFenceInfo: function () {
                    let e = this.resume();
                    this.stack[this.stack.length - 1].lang = e;
                  },
                  codeFencedFenceMeta: function () {
                    let e = this.resume();
                    this.stack[this.stack.length - 1].meta = e;
                  },
                  codeFlowValue: f,
                  codeIndented: a(function () {
                    let e = this.resume();
                    this.stack[this.stack.length - 1].value = e.replace(
                      /(\r?\n|\r)$/g,
                      "",
                    );
                  }),
                  codeText: a(function () {
                    let e = this.resume();
                    this.stack[this.stack.length - 1].value = e;
                  }),
                  codeTextData: f,
                  data: f,
                  definition: a(),
                  definitionDestinationString: function () {
                    let e = this.resume();
                    this.stack[this.stack.length - 1].url = e;
                  },
                  definitionLabelString: function (e) {
                    let t = this.resume(),
                      n = this.stack[this.stack.length - 1];
                    ((n.label = t),
                      (n.identifier = et(
                        this.sliceSerialize(e),
                      ).toLowerCase()));
                  },
                  definitionTitleString: function () {
                    let e = this.resume();
                    this.stack[this.stack.length - 1].title = e;
                  },
                  emphasis: a(),
                  hardBreakEscape: a(h),
                  hardBreakTrailing: a(h),
                  htmlFlow: a(function () {
                    let e = this.resume();
                    this.stack[this.stack.length - 1].value = e;
                  }),
                  htmlFlowData: f,
                  htmlText: a(function () {
                    let e = this.resume();
                    this.stack[this.stack.length - 1].value = e;
                  }),
                  htmlTextData: f,
                  image: a(function () {
                    let e = this.stack[this.stack.length - 1];
                    if (this.data.inReference) {
                      let t = this.data.referenceType || "shortcut";
                      ((e.type += "Reference"),
                        (e.referenceType = t),
                        delete e.url,
                        delete e.title);
                    } else (delete e.identifier, delete e.label);
                    this.data.referenceType = void 0;
                  }),
                  label: function () {
                    let e = this.stack[this.stack.length - 1],
                      t = this.resume(),
                      n = this.stack[this.stack.length - 1];
                    ((this.data.inReference = !0),
                      "link" === n.type
                        ? (n.children = e.children)
                        : (n.alt = t));
                  },
                  labelText: function (e) {
                    let t = this.sliceSerialize(e),
                      n = this.stack[this.stack.length - 2];
                    ((n.label = t.replace(ew, eS)),
                      (n.identifier = et(t).toLowerCase()));
                  },
                  lineEnding: function (e) {
                    let n = this.stack[this.stack.length - 1];
                    if (this.data.atHardBreak) {
                      ((n.children[n.children.length - 1].position.end = eA(
                        e.end,
                      )),
                        (this.data.atHardBreak = void 0));
                      return;
                    }
                    !this.data.setextHeadingSlurpLineEnding &&
                      t.canContainEols.includes(n.type) &&
                      (l.call(this, e), f.call(this, e));
                  },
                  link: a(function () {
                    let e = this.stack[this.stack.length - 1];
                    if (this.data.inReference) {
                      let t = this.data.referenceType || "shortcut";
                      ((e.type += "Reference"),
                        (e.referenceType = t),
                        delete e.url,
                        delete e.title);
                    } else (delete e.identifier, delete e.label);
                    this.data.referenceType = void 0;
                  }),
                  listItem: a(),
                  listOrdered: a(),
                  listUnordered: a(),
                  paragraph: a(),
                  referenceString: function (e) {
                    let t = this.resume(),
                      n = this.stack[this.stack.length - 1];
                    ((n.label = t),
                      (n.identifier = et(this.sliceSerialize(e)).toLowerCase()),
                      (this.data.referenceType = "full"));
                  },
                  resourceDestinationString: function () {
                    let e = this.resume();
                    this.stack[this.stack.length - 1].url = e;
                  },
                  resourceTitleString: function () {
                    let e = this.resume();
                    this.stack[this.stack.length - 1].title = e;
                  },
                  resource: function () {
                    this.data.inReference = void 0;
                  },
                  setextHeading: a(function () {
                    this.data.setextHeadingSlurpLineEnding = void 0;
                  }),
                  setextHeadingLineSequence: function (e) {
                    this.stack[this.stack.length - 1].depth =
                      61 === this.sliceSerialize(e).codePointAt(0) ? 1 : 2;
                  },
                  setextHeadingText: function () {
                    this.data.setextHeadingSlurpLineEnding = !0;
                  },
                  strong: a(),
                  thematicBreak: a(),
                },
              };
              !(function e(t, n) {
                let r = -1;
                for (; ++r < n.length;) {
                  let i = n[r];
                  Array.isArray(i)
                    ? e(t, i)
                    : (function (e, t) {
                        let n;
                        for (n in t)
                          if (ez.call(t, n))
                            switch (n) {
                              case "canContainEols": {
                                let r = t[n];
                                r && e[n].push(...r);
                                break;
                              }
                              case "transforms": {
                                let r = t[n];
                                r && e[n].push(...r);
                                break;
                              }
                              case "enter":
                              case "exit": {
                                let r = t[n];
                                r && Object.assign(e[n], r);
                              }
                            }
                      })(t, i);
                }
              })(t, (e || {}).mdastExtensions || []);
              let r = {};
              return function (e) {
                let n = { type: "root", children: [] },
                  i = {
                    stack: [n],
                    tokenStack: [],
                    config: t,
                    enter: s,
                    exit: u,
                    buffer: o,
                    resume: c,
                    data: r,
                  },
                  a = [],
                  l = -1;
                for (; ++l < e.length;)
                  ("listOrdered" === e[l][1].type ||
                    "listUnordered" === e[l][1].type) &&
                    ("enter" === e[l][0]
                      ? a.push(l)
                      : (l = (function (e, t, n) {
                          let r,
                            i,
                            o,
                            s,
                            a = t - 1,
                            u = -1,
                            c = !1;
                          for (; ++a <= n;) {
                            let t = e[a];
                            switch (t[1].type) {
                              case "listUnordered":
                              case "listOrdered":
                              case "blockQuote":
                                ("enter" === t[0] ? u++ : u--, (s = void 0));
                                break;
                              case "lineEndingBlank":
                                "enter" === t[0] &&
                                  (!r || s || u || o || (o = a), (s = void 0));
                                break;
                              case "linePrefix":
                              case "listItemValue":
                              case "listItemMarker":
                              case "listItemPrefix":
                              case "listItemPrefixWhitespace":
                                break;
                              default:
                                s = void 0;
                            }
                            if (
                              (!u &&
                                "enter" === t[0] &&
                                "listItemPrefix" === t[1].type) ||
                              (-1 === u &&
                                "exit" === t[0] &&
                                ("listUnordered" === t[1].type ||
                                  "listOrdered" === t[1].type))
                            ) {
                              if (r) {
                                let s = a;
                                for (i = void 0; s--;) {
                                  let t = e[s];
                                  if (
                                    "lineEnding" === t[1].type ||
                                    "lineEndingBlank" === t[1].type
                                  ) {
                                    if ("exit" === t[0]) continue;
                                    (i &&
                                      ((e[i][1].type = "lineEndingBlank"),
                                      (c = !0)),
                                      (t[1].type = "lineEnding"),
                                      (i = s));
                                  } else if (
                                    "linePrefix" === t[1].type ||
                                    "blockQuotePrefix" === t[1].type ||
                                    "blockQuotePrefixWhitespace" ===
                                      t[1].type ||
                                    "blockQuoteMarker" === t[1].type ||
                                    "listItemIndent" === t[1].type
                                  );
                                  else break;
                                }
                                (o && (!i || o < i) && (r._spread = !0),
                                  (r.end = Object.assign(
                                    {},
                                    i ? e[i][1].start : t[1].end,
                                  )),
                                  e.splice(i || a, 0, ["exit", r, t[2]]),
                                  a++,
                                  n++);
                              }
                              if ("listItemPrefix" === t[1].type) {
                                let i = {
                                  type: "listItem",
                                  _spread: !1,
                                  start: Object.assign({}, t[1].start),
                                  end: void 0,
                                };
                                ((r = i),
                                  e.splice(a, 0, ["enter", i, t[2]]),
                                  a++,
                                  n++,
                                  (o = void 0),
                                  (s = !0));
                              }
                            }
                          }
                          return ((e[t][1]._spread = c), n);
                        })(e, a.pop(), l)));
                for (l = -1; ++l < e.length;) {
                  let n = t[e[l][0]];
                  ez.call(n, e[l][1].type) &&
                    n[e[l][1].type].call(
                      Object.assign(
                        { sliceSerialize: e[l][2].sliceSerialize },
                        i,
                      ),
                      e[l][1],
                    );
                }
                if (i.tokenStack.length > 0) {
                  let e = i.tokenStack[i.tokenStack.length - 1];
                  (e[1] || eC).call(i, void 0, e[0]);
                }
                for (
                  n.position = {
                    start: eA(
                      e.length > 0
                        ? e[0][1].start
                        : { line: 1, column: 1, offset: 0 },
                    ),
                    end: eA(
                      e.length > 0
                        ? e[e.length - 2][1].end
                        : { line: 1, column: 1, offset: 0 },
                    ),
                  },
                    l = -1;
                  ++l < t.transforms.length;
                )
                  n = t.transforms[l](n) || n;
                return n;
              };
              function i(e, t) {
                return function (n) {
                  (s.call(this, e(n), n), t && t.call(this, n));
                };
              }
              function o() {
                this.stack.push({ type: "fragment", children: [] });
              }
              function s(e, t, n) {
                (this.stack[this.stack.length - 1].children.push(e),
                  this.stack.push(e),
                  this.tokenStack.push([t, n || void 0]),
                  (e.position = { start: eA(t.start), end: void 0 }));
              }
              function a(e) {
                return function (t) {
                  (e && e.call(this, t), u.call(this, t));
                };
              }
              function u(e, t) {
                let n = this.stack.pop(),
                  r = this.tokenStack.pop();
                if (r)
                  r[0].type !== e.type &&
                    (t
                      ? t.call(this, e, r[0])
                      : (r[1] || eC).call(this, e, r[0]));
                else
                  throw Error(
                    "Cannot close `" +
                      e.type +
                      "` (" +
                      eT({ start: e.start, end: e.end }) +
                      "): it’s not open",
                  );
                n.position.end = eA(e.end);
              }
              function c() {
                return n(this.stack.pop());
              }
              function l(e) {
                let t = this.stack[this.stack.length - 1].children,
                  n = t[t.length - 1];
                ((n && "text" === n.type) ||
                  (((n = { type: "text", value: "" }).position = {
                    start: eA(e.start),
                    end: void 0,
                  }),
                  t.push(n)),
                  this.stack.push(n));
              }
              function f(e) {
                let t = this.stack.pop();
                ((t.value += this.sliceSerialize(e)),
                  (t.position.end = eA(e.end)));
              }
              function h() {
                this.data.atHardBreak = !0;
              }
              function d(e) {
                this.data.characterReferenceType = e.type;
              }
              function p() {
                return { type: "code", lang: null, meta: null, value: "" };
              }
              function g() {
                return { type: "heading", depth: 0, children: [] };
              }
              function m() {
                return { type: "break" };
              }
              function y() {
                return { type: "html", value: "" };
              }
              function k() {
                return { type: "link", title: null, url: "", children: [] };
              }
              function x(e) {
                return {
                  type: "list",
                  ordered: "listOrdered" === e.type,
                  start: null,
                  spread: e._spread,
                  children: [],
                };
              }
            })(u)(
              (function (e) {
                for (; !z(e););
                return e;
              })(
                (function (e) {
                  let t = {
                    constructs: (function (e) {
                      let t = {},
                        n = -1;
                      for (; ++n < e.length;)
                        !(function (e, t) {
                          let n;
                          for (n in t) {
                            let r,
                              i = (a.call(e, n) ? e[n] : void 0) || (e[n] = {}),
                              s = t[n];
                            if (s)
                              for (r in s) {
                                a.call(i, r) || (i[r] = []);
                                let e = s[r];
                                !(function (e, t) {
                                  let n = -1,
                                    r = [];
                                  for (; ++n < t.length;)
                                    ("after" === t[n].add ? e : r).push(t[n]);
                                  o(e, 0, 0, r);
                                })(i[r], Array.isArray(e) ? e : e ? [e] : []);
                              }
                          }
                        })(t, e[n]);
                      return t;
                    })([ex, ...((e || {}).extensions || [])]),
                    content: n(w),
                    defined: [],
                    document: n(S),
                    flow: n(F),
                    lazy: {},
                    string: n(M),
                    text: n(L),
                  };
                  return t;
                  function n(e) {
                    return function (n) {
                      return (function (e, t, n) {
                        let r = {
                            _bufferIndex: -1,
                            _index: 0,
                            line: (n && n.line) || 1,
                            column: (n && n.column) || 1,
                            offset: (n && n.offset) || 0,
                          },
                          i = {},
                          a = [],
                          u = [],
                          c = [],
                          l = {
                            attempt: y(function (e, t) {
                              k(e, t.from);
                            }),
                            check: y(m),
                            consume: function (e) {
                              (g(e)
                                ? (r.line++,
                                  (r.column = 1),
                                  (r.offset += -3 === e ? 2 : 1),
                                  x())
                                : -1 !== e && (r.column++, r.offset++),
                                r._bufferIndex < 0
                                  ? r._index++
                                  : (r._bufferIndex++,
                                    r._bufferIndex === u[r._index].length &&
                                      ((r._bufferIndex = -1), r._index++)),
                                (f.previous = e));
                            },
                            enter: function (e, t) {
                              let n = t || {};
                              return (
                                (n.type = e),
                                (n.start = p()),
                                f.events.push(["enter", n, f]),
                                c.push(n),
                                n
                              );
                            },
                            exit: function (e) {
                              let t = c.pop();
                              return (
                                (t.end = p()),
                                f.events.push(["exit", t, f]),
                                t
                              );
                            },
                            interrupt: y(m, { interrupt: !0 }),
                          },
                          f = {
                            code: null,
                            containerState: {},
                            defineSkip: function (e) {
                              ((i[e.line] = e.column), x());
                            },
                            events: [],
                            now: p,
                            parser: e,
                            previous: null,
                            sliceSerialize: function (e, t) {
                              return (function (e, t) {
                                let n,
                                  r = -1,
                                  i = [];
                                for (; ++r < e.length;) {
                                  let o,
                                    s = e[r];
                                  if ("string" == typeof s) o = s;
                                  else
                                    switch (s) {
                                      case -5:
                                        o = "\r";
                                        break;
                                      case -4:
                                        o = "\n";
                                        break;
                                      case -3:
                                        o = "\r\n";
                                        break;
                                      case -2:
                                        o = t ? " " : "	";
                                        break;
                                      case -1:
                                        if (!t && n) continue;
                                        o = " ";
                                        break;
                                      default:
                                        o = String.fromCharCode(s);
                                    }
                                  ((n = -2 === s), i.push(o));
                                }
                                return i.join("");
                              })(d(e), t);
                            },
                            sliceStream: d,
                            write: function (e) {
                              return ((u = s(u, e)),
                              (function () {
                                let e;
                                for (; r._index < u.length;) {
                                  let n = u[r._index];
                                  if ("string" == typeof n)
                                    for (
                                      e = r._index,
                                        r._bufferIndex < 0 &&
                                          (r._bufferIndex = 0);
                                      r._index === e &&
                                      r._bufferIndex < n.length;
                                    ) {
                                      var t;
                                      ((t = n.charCodeAt(r._bufferIndex)),
                                        (h = h(t)));
                                    }
                                  else h = h(n);
                                }
                              })(),
                              null !== u[u.length - 1])
                                ? []
                                : (k(t, 0),
                                  (f.events = B(a, f.events, f)),
                                  f.events);
                            },
                          },
                          h = t.tokenize.call(f, l);
                        return (t.resolveAll && a.push(t), f);
                        function d(e) {
                          return (function (e, t) {
                            let n,
                              r = t.start._index,
                              i = t.start._bufferIndex,
                              o = t.end._index,
                              s = t.end._bufferIndex;
                            if (r === o) n = [e[r].slice(i, s)];
                            else {
                              if (((n = e.slice(r, o)), i > -1)) {
                                let e = n[0];
                                "string" == typeof e
                                  ? (n[0] = e.slice(i))
                                  : n.shift();
                              }
                              s > 0 && n.push(e[o].slice(0, s));
                            }
                            return n;
                          })(u, e);
                        }
                        function p() {
                          let {
                            _bufferIndex: e,
                            _index: t,
                            line: n,
                            column: i,
                            offset: o,
                          } = r;
                          return {
                            _bufferIndex: e,
                            _index: t,
                            line: n,
                            column: i,
                            offset: o,
                          };
                        }
                        function m(e, t) {
                          t.restore();
                        }
                        function y(e, t) {
                          return function (n, i, o) {
                            var s;
                            let a, u, h, d;
                            return Array.isArray(n)
                              ? g(n)
                              : "tokenize" in n
                                ? g([n])
                                : ((s = n),
                                  function (e) {
                                    let t = null !== e && s[e],
                                      n = null !== e && s.null;
                                    return g([
                                      ...(Array.isArray(t) ? t : t ? [t] : []),
                                      ...(Array.isArray(n) ? n : n ? [n] : []),
                                    ])(e);
                                  });
                            function g(e) {
                              return ((a = e), (u = 0), 0 === e.length)
                                ? o
                                : m(e[u]);
                            }
                            function m(e) {
                              return function (n) {
                                let i, o, s, a, u;
                                return ((i = p()),
                                (o = f.previous),
                                (s = f.currentConstruct),
                                (a = f.events.length),
                                (u = Array.from(c)),
                                (d = {
                                  from: a,
                                  restore: function () {
                                    ((r = i),
                                      (f.previous = o),
                                      (f.currentConstruct = s),
                                      (f.events.length = a),
                                      (c = u),
                                      x());
                                  },
                                }),
                                (h = e),
                                e.partial || (f.currentConstruct = e),
                                e.name &&
                                  f.parser.constructs.disable.null.includes(
                                    e.name,
                                  ))
                                  ? k(n)
                                  : e.tokenize.call(
                                      t
                                        ? Object.assign(Object.create(f), t)
                                        : f,
                                      l,
                                      y,
                                      k,
                                    )(n);
                              };
                            }
                            function y(t) {
                              return (e(h, d), i);
                            }
                            function k(e) {
                              return (d.restore(), ++u < a.length)
                                ? m(a[u])
                                : o;
                            }
                          };
                        }
                        function k(e, t) {
                          (e.resolveAll && !a.includes(e) && a.push(e),
                            e.resolve &&
                              o(
                                f.events,
                                t,
                                f.events.length - t,
                                e.resolve(f.events.slice(t), f),
                              ),
                            e.resolveTo &&
                              (f.events = e.resolveTo(f.events, f)));
                        }
                        function x() {
                          r.line in i &&
                            r.column < 2 &&
                            ((r.column = i[r.line]),
                            (r.offset += i[r.line] - 1));
                        }
                      })(t, e, n);
                    };
                  }
                })(u)
                  .document()
                  .write(
                    ((l = 1),
                    (f = ""),
                    (h = !0),
                    function (e, t, n) {
                      let r,
                        i,
                        o,
                        s,
                        a,
                        u = [];
                      for (
                        e =
                          f +
                          ("string" == typeof e
                            ? e.toString()
                            : new TextDecoder(t || void 0).decode(e)),
                          o = 0,
                          f = "",
                          h && (65279 === e.charCodeAt(0) && o++, (h = void 0));
                        o < e.length;
                      ) {
                        if (
                          ((ev.lastIndex = o),
                          (s =
                            (r = ev.exec(e)) && void 0 !== r.index
                              ? r.index
                              : e.length),
                          (a = e.charCodeAt(s)),
                          !r)
                        ) {
                          f = e.slice(o);
                          break;
                        }
                        if (10 === a && o === s && c)
                          (u.push(-3), (c = void 0));
                        else
                          switch (
                            (c && (u.push(-5), (c = void 0)),
                            o < s && (u.push(e.slice(o, s)), (l += s - o)),
                            a)
                          ) {
                            case 0:
                              (u.push(65533), l++);
                              break;
                            case 9:
                              for (
                                i = 4 * Math.ceil(l / 4), u.push(-2);
                                l++ < i;
                              )
                                u.push(-1);
                              break;
                            case 10:
                              (u.push(-4), (l = 1));
                              break;
                            default:
                              ((c = !0), (l = 1));
                          }
                        o = s + 1;
                      }
                      return (
                        n && (c && u.push(-5), f && u.push(f), u.push(null)),
                        u
                      );
                    })(r, i, !0),
                  ),
              ),
            )
          );
        };
      }),
      e8 = new Map();
    function te(e) {
      let t = e8.get(e);
      if (t) return t;
      let n = e7.parse(e);
      return (e8.set(e, n), n);
    }
    function tt(e) {
      let t = te(e),
        r = [];
      return (
        e9(t, "paragraph", (e, t, i) => {
          i?.type === "root" && r.push(n(e));
        }),
        r
      );
    }
    e.s(
      [
        "getContentBlocks",
        0,
        function (e) {
          let t = te(e),
            r = [];
          for (let e of t.children)
            if ("heading" === e.type)
              r.push({ type: "heading", depth: e.depth, text: n(e) });
            else if ("paragraph" === e.type)
              r.push({ type: "paragraph", text: n(e) });
            else if ("list" === e.type) {
              let t = [];
              for (let r of e.children) {
                let e,
                  i = n(r);
                (e9(r, "strong", (t) => {
                  e || (e = n(t));
                }),
                  t.push({ text: i, strong: e }));
              }
              r.push({ type: "list", ordered: e.ordered ?? !1, items: t });
            }
          return r;
        },
        "getParagraphs",
        0,
        tt,
        "getParagraphsText",
        0,
        function (e) {
          return tt(e).join("\n\n");
        },
        "getTitle",
        0,
        function (e) {
          let t = te(e),
            r = "";
          return (
            e9(t, "heading", (e) => {
              1 !== e.depth || r || (r = n(e));
            }),
            r
          );
        },
      ],
      44664,
    );
  },
  57781,
  (e) => {
    "use strict";
    e.s([
      "address",
      0,
      {
        street: "Laxholmstorget 3",
        postalCode: "602 21",
        city: "Norrköping",
        country: "Sweden",
        countryCode: "SE",
      },
      "company",
      0,
      {
        name: "Shader Development Studio",
        legalName: "Shader Sweden AB",
        tagline:
          "Empowering your business with next-generation interactive 3D and AI solutions.",
        taxID: "5593233140",
      },
      "emails",
      0,
      {
        general: "hello@shader.se",
        ceo: "ceo@shader.se",
        secretary: "secretary@shader.se",
      },
      "links",
      0,
      { bookACall: "https://cal.com/filip-kantedal-hd30xa/30min" },
      "social",
      0,
      {
        linkedin: "https://www.linkedin.com/company/shadersweden/",
        instagram: "https://www.instagram.com/shadersweden/",
        twitter: "https://x.com/shadersweden",
      },
    ]);
  },
  72219,
  (e) => {
    "use strict";
    var t = e.i(59814);
    let n = (0, e.i(43245).create)(() => {
      let e = (0, t.motionValue)(null),
        n = (0, t.motionValue)(null),
        r = (0, t.motionValue)({});
      return {
        focusedElement: e,
        focusSource: n,
        elementPositions: r,
        setFocusedElement: (t, r) => {
          (e.set(t), n.set(r));
        },
        setElementPosition: (e, t) => {
          r.set({ ...r.get(), [e]: t });
        },
      };
    });
    e.s(["useA11yStore", 0, n]);
  },
  76763,
  (e) => {
    "use strict";
    let t =
        "# The Bottom Line on Accessibility\n\nWe know what we are doing when it comes to web accessibility. We are intimately familiar with WCAG guidelines, and we believe the web should be open for everyone to do business. But pushing pixels into the Z-axis makes standard screen-reader integration and keyboard navigation a complex merger.\n\nHere is what we've done to bridge the gap between radical 3D innovation and universal access:\n\n- **The Shadow Boardroom:** We have engineered hidden DOM elements and ARIA labels that operate behind the 3D graphics to communicate with assistive technologies.\n- **Executive Keystrokes:** We've implemented custom keyboard navigation to ensure you can tab through our 3D space without needing a mouse.\n- **High-Contrast Mindset:** Our visual assets are designed to pop, keeping legibility in mind even when the camera is panning through cyberspace.\n",
      n =
        "# Where We Fall Short\n\nDespite our best efforts to future-proof this asset, rendering text and interactive elements purely to a 3D canvas means it might not behave perfectly with every piece of assistive technology on the market. We haven't cut corners, we just extruded them into the third dimension, but we acknowledge that the experience might not be 100 percent seamless for everyone.\n",
      r =
        "# Statement On Accessibility: Pushing Pixels into the Future\n\nAt Shader, we don't just dress for the job we want, complete with aggressive shoulder pads and power ties, we build for the future. You've probably noticed that our digital real estate isn't your standard, flat-file brochure. It is rendered entirely in glorious, state-of-the-art WebGPU and WebGL.\n\nWhy did we bypass the standard document object model to put our entire enterprise on a single canvas element? Simple: Because it's a paradigm shift. We do web, AI, and 3D visualization, and we wanted a corporate homepage that flexes our technical muscles, maximizes synergy, and looks incredibly cool doing it.\n\nHowever, the boys down in RnD have informed management of a slight \"friction in the paradigm.\"\n",
      i =
        "# Our Open-Door Policy\n\nIf our cutting-edge 3D canvas is creating a bottleneck in your workflow or blocking your productivity, we want to know about it. At the end of the day, we are in the business of delivering results, not digital red tape. Please have your people reach out to our executive secretary via the electronic mail system at secretary@shader.se. We will happily fast-track a plain-text dossier of our services directly to your inbox, assist you with scoping your next project, or just talk shop about the future of AI.\n";
    var o = e.i(44664);
    let s = {
      title: (0, o.getTitle)(r),
      body: (0, o.getParagraphsText)(r),
      markdown: r,
    };
    ((0, o.getTitle)(t),
      (0, o.getParagraphsText)(t),
      (0, o.getContentBlocks)(t),
      (0, o.getTitle)(n),
      (0, o.getParagraphsText)(n),
      (0, o.getTitle)(i),
      (0, o.getParagraphsText)(i));
    let a = [
      ...(0, o.getContentBlocks)(r).filter(
        (e) => "heading" !== e.type || 1 !== e.depth,
      ),
      ...(0, o.getContentBlocks)(t),
      ...(0, o.getContentBlocks)(n),
      ...(0, o.getContentBlocks)(i),
    ];
    e.s(
      ["accessibilityContentBlocksMd", 0, a, "accessibilityIntroMd", 0, s],
      76763,
    );
  },
  50735,
  10840,
  (e) => {
    "use strict";
    let t =
        "# A Showcase of Valued Clients\n\nWe have had the benefit of working with a large pool of great clients throughout the years. Our partnerships ranges from some of the most recognizable Swedish brands to international innovators.\n",
      n =
        "# Making Digital Storytelling More Playful, Powerful, and Alive\n\nShader is a creative development studio specialized in building interactive 3D and AI solutions for the web. Serious about business, based in Sweden, and working with brands, agencies and designers worldwide.\n\nPlugged into the future. While we're a small team of creative engineers, we have a hand-picked network of collaborators: designers, 3D artists, copywriters, animators, and creative technologists, ready to plug in with an array of capabilities.\n\nThis modular approach means we can scale and adapt to each challenge. Whether it's a WebGL experiment, an interactive product visualization, a mobile app, or an AI-driven experience, we help bold brands stand out across every screen.\n\nWe build storytelling platforms that demand attention and reward curiosity. We push digital mediums to places you haven't seen before, and have fun doing it. Beyond code, we offer 3D design and animation, UI and motion design, concepts and digital strategy, full-stack development, and creative consulting.\n\nWhether it's prototyping an idea, launching an augmented reality experience, or bringing high-fidelity visuals to life, Shader bridges the gap between creative ambition and technical execution. Our process is hands-on, collaborative, and tailored for teams that value both craft and innovation. We combine technical expertise with a designer's eye, ensuring that every interaction feels natural and every pixel is perfectly placed. We're not your regular IT department. We don't troubleshoot printers.\n",
      r =
        "# For Companies Serious About Technology\n\nIn today's fast-paced corporate landscape, you need a partner who understands the bottom line. At Shader, we engineer success through strategic alliances and mutual profitability. Our team is ready to synergize with your organization, unlock new verticals, and maximize your digital ROI. We don't just close deals; we deliver results that compound.\n\nWe leverage state-of-the-art technology to give your brand a decisive competitive advantage. Whether disrupting the market with paradigm-shifting 3D experiences or streamlining operations with cutting-edge AI, we provide turnkey solutions that scale. We merge high-performance engineering with executive-level design to build assets that appreciate your brand value.\n\nReady to take your enterprise to the next level? Don't waste valuable time. Review our portfolio, crunch the numbers, and you'll see the trajectory points one way: up. Pick up the phone, send a fax, or schedule a consultation. The future of your business is waiting. Let's execute.\n",
      i =
        "# Act now! Book a Consultation.\n\nCut along the dotted line and mail this to the post address below for a free 30 minute video call consultation.\n",
      o = "# Had Enough Reading? Let's Shred This Thing.\n";
    var s = e.i(44664);
    let a = {
        title: (0, s.getTitle)(n),
        body: (0, s.getParagraphsText)(n),
        markdown: n,
      },
      u = {
        title: (0, s.getTitle)(t),
        body: (0, s.getParagraphsText)(t),
        markdown: t,
      },
      c = {
        title: (0, s.getTitle)(r),
        body: (0, s.getParagraphsText)(r),
        paragraphs: (0, s.getParagraphs)(r),
        markdown: r,
      },
      l = {
        title: (0, s.getTitle)(i),
        body: (0, s.getParagraphsText)(i),
        markdown: i,
      };
    ((0, s.getTitle)(o), (0, s.getParagraphsText)(o));
    let f = [
      ...(0, s.getContentBlocks)(n).filter(
        (e) => "heading" !== e.type || 1 !== e.depth,
      ),
      ...(0, s.getContentBlocks)(t),
      ...(0, s.getContentBlocks)(r),
      ...(0, s.getContentBlocks)(o),
    ];
    (e.s(
      [
        "aboutClientsMd",
        0,
        u,
        "aboutContentBlocksMd",
        0,
        f,
        "aboutIntroMd",
        0,
        a,
        "aboutSeriousBookACallMd",
        0,
        l,
        "aboutSeriousMd",
        0,
        c,
      ],
      50735,
    ),
      e.i(57781));
    let h =
        "# Contact\n\nContact us about your digital project idea or general enquires. Let's interface, call us today!\n",
      d = (0, s.getParagraphs)(h),
      p = {
        title: (0, s.getTitle)(h),
        intro: d[0] ?? "",
        contentBlocks: (0, s.getContentBlocks)(h),
        markdown: h,
      };
    e.s(["contactMd", 0, p], 10840);
  },
  28263,
  (e) => {
    "use strict";
    var t = e.i(59814);
    let n = (0, e.i(43245).create)(() => ({
      showText: (0, t.motionValue)(!1),
    }));
    e.s(["useHeroStore", 0, n]);
  },
  34231,
  (e) => {
    "use strict";
    let t =
      "# A Creative Development Studio, Plugged into the Future\n\nScroll to Inspect Our Closed Deals\n";
    var n = e.i(44664);
    let r = {
      title: (0, n.getTitle)(t),
      subtitle: (0, n.getParagraphsText)(t),
      markdown: t,
    };
    e.s(["heroMd", 0, r], 34231);
  },
  85389,
  (e) => {
    "use strict";
    let t = "function" == typeof Float32Array;
    function n(e, t, n) {
      return (((1 - 3 * n + 3 * t) * e + (3 * n - 6 * t)) * e + 3 * t) * e;
    }
    function r(e, t, n) {
      return 3 * (1 - 3 * n + 3 * t) * e * e + 2 * (3 * n - 6 * t) * e + 3 * t;
    }
    function i(e) {
      return e;
    }
    e.s([
      "bezier",
      0,
      function (e, o, s, a) {
        if (!(0 <= e && e <= 1 && 0 <= s && s <= 1))
          throw Error("bezier x values must be in [0, 1] range");
        if (e === o && s === a) return i;
        let u = t ? new Float32Array(11) : Array(11);
        for (let t = 0; t < 11; ++t) u[t] = n(0.1 * t, e, s);
        return function (t) {
          return 0 === t || 1 === t
            ? t
            : n(
                (function (t) {
                  let i = 0,
                    o = 1;
                  for (; 10 !== o && (u[o] ?? 0) <= t; ++o) i += 0.1;
                  let a = u[--o] ?? 0,
                    c = i + ((t - a) / ((u[o + 1] ?? 0) - a)) * 0.1,
                    l = r(c, e, s);
                  if (l >= 0.001) {
                    var f = c;
                    for (let i = 0; i < 4; ++i) {
                      let i = r(f, e, s);
                      if (0 === i) break;
                      let o = n(f, e, s) - t;
                      f -= o / i;
                    }
                    return f;
                  }
                  return 0 === l
                    ? c
                    : (function (e, t, r, i, o) {
                        let s,
                          a,
                          u = 0;
                        do
                          (s = n((a = t + (r - t) / 2), i, o) - e) > 0
                            ? (r = a)
                            : (t = a);
                        while (Math.abs(s) > 1e-7 && ++u < 10);
                        return a;
                      })(t, i, i + 0.1, e, s);
                })(t),
                o,
                a,
              );
        };
      },
    ]);
  },
  89582,
  (e) => {
    "use strict";
    var t = e.i(26050),
      n = e.i(50987),
      r = e.i(83066),
      i = e.i(85389),
      o = e.i(86536),
      s = e.i(28263),
      a = e.i(90551),
      u = e.i(2464),
      c = e.i(71402);
    function l(e) {
      return e.subPage;
    }
    function f(e) {
      return e.mainPage.scrollProgress;
    }
    function h(e) {
      return e.mainPage.isLocked;
    }
    function d(e) {
      return e.sectionLensDistortionBorder;
    }
    function p(e) {
      return e.sectionLensDistortion;
    }
    function g(e) {
      return e.sectionTransitionState;
    }
    function m(e) {
      return e.sectionTransition;
    }
    e.s([
      "useNavbarClickHandler",
      0,
      function () {
        let e,
          y = (0, t.c)(9),
          k = (0, a.usePagesStore)(m),
          x = (0, a.usePagesStore)(g),
          v = (0, a.usePagesStore)(p),
          b = (0, a.usePagesStore)(d),
          w = (0, c.useScrollStore)(h),
          S = (0, c.useScrollStore)(f),
          T = (0, a.usePagesStore)(l),
          P = (0, r.useRouter)();
        return (
          y[0] !== T ||
          y[1] !== w ||
          y[2] !== S ||
          y[3] !== P ||
          y[4] !== v ||
          y[5] !== b ||
          y[6] !== k ||
          y[7] !== x
            ? ((e = (e) => {
                let t = c.useScrollStore.getState().lenis,
                  r = T.get()?.type,
                  l = a.usePagesStore.getState(),
                  f = (0, o.getMainPageHref)(e);
                if (!t) return;
                if ("not-found" === r) {
                  w.set(!0);
                  let t = l.getPage(e);
                  (a.usePagesStore
                    .getState()
                    .notFoundNavigateTo.set(t.range.start),
                    S.set(t.range.start),
                    P.push(f, { scroll: !1 }),
                    "hero" !== e &&
                      u.useProjectsStore.getState().initialized.set(!0));
                  return;
                }
                if ("project" === r) return;
                let h = l.getPage(e),
                  d = l.activePage.get();
                if (
                  (window.umami.track(`navbar_click_${e}`),
                  window.history.replaceState(window.history.state, "", f),
                  d === h.id || ("about-us" === h.id && "office" === d))
                )
                  return;
                if ("hero" === d && "projects" === h.id) {
                  let e = (0, i.bezier)(0.48, 0.09, 0.22, 1);
                  t.scrollTo(h.range.start * window.innerHeight, {
                    duration: 0.8,
                    easing: e,
                    lock: !0,
                  });
                  return;
                }
                if ("projects" === d && "hero" === h.id) {
                  let e = (0, i.bezier)(0.48, 0.09, 0.22, 1);
                  t.scrollTo(h.range.start * window.innerHeight, {
                    duration: 0.8,
                    easing: e,
                    lock: !0,
                  });
                  return;
                }
                ("about-us" === h.id || "contact" === h.id
                  ? u.useProjectsStore.getState().initialized.set(!0)
                  : "hero" === h.id &&
                    ("about-us" === d || "contact" === d || "office" === d) &&
                    u.useProjectsStore.getState().initialized.set(!1),
                  "hero" === d &&
                    "projects" !== h.id &&
                    s.useHeroStore.getState().showText.set(!1));
                let p = h.range.start;
                ("about-us" === h.id
                  ? (p = h.range.start)
                  : "contact" === h.id && (p = h.range.start + 0.05),
                  x.set({ to: e, target: p }),
                  v.set(h.effects.lensDistortion),
                  b.set(h.effects.lensDistortionBorders),
                  t.stop(),
                  (0, n.animate)(k, 1, {
                    duration: 1.25,
                    onComplete: () => {
                      (t.start(),
                        x.set(null),
                        k.set(0),
                        v.set(0),
                        b.set(0),
                        t.scrollTo(p * window.innerHeight, { immediate: !0 }));
                    },
                  }));
              }),
              (y[0] = T),
              (y[1] = w),
              (y[2] = S),
              (y[3] = P),
              (y[4] = v),
              (y[5] = b),
              (y[6] = k),
              (y[7] = x),
              (y[8] = e))
            : (e = y[8]),
          e
        );
      },
    ]);
  },
]);
