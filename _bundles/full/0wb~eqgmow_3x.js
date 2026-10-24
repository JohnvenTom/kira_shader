(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([
  "object" == typeof document ? document.currentScript : void 0,
  18885,
  (e, t, i) => {
    "use strict";
    var s =
      e.r(
        25790,
      ).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    i.c = function (e) {
      return s.H.useMemoCache(e);
    };
  },
  26050,
  (e, t, i) => {
    "use strict";
    t.exports = e.r(18885);
  },
  8594,
  (e) => {
    "use strict";
    var t = e.i(25790);
    e.s([
      "useMotionValueEvent",
      0,
      function (e, i, s) {
        (0, t.useInsertionEffect)(() => e.on(i, s), [e, i, s]);
      },
    ]);
  },
  84318,
  (e) => {
    "use strict";
    e.s(["MotionGlobalConfig", 0, { skipAnimations: !1, useManualTiming: !1 }]);
  },
  91069,
  (e) => {
    "use strict";
    e.s(["noop", 0, (e) => e]);
  },
  10873,
  44795,
  40591,
  (e) => {
    "use strict";
    let t;
    var i = e.i(84318),
      s = e.i(91069);
    let n = [
        "read",
        "resolveKeyframes",
        "update",
        "preRender",
        "render",
        "postRender",
      ],
      r = { value: null, addProjectionMetrics: null };
    e.s(["statsBuffer", 0, r], 44795);
    let {
      schedule: a,
      cancel: o,
      state: l,
      steps: u,
    } = (function (e, t) {
      let s = !1,
        a = !0,
        o = { delta: 0, timestamp: 0, isProcessing: !1 },
        l = () => (s = !0),
        u = n.reduce(
          (e, i) => (
            (e[i] = (function (e, t) {
              let i = new Set(),
                s = new Set(),
                n = !1,
                a = !1,
                o = new WeakSet(),
                l = { delta: 0, timestamp: 0, isProcessing: !1 },
                u = 0;
              function h(t) {
                (o.has(t) && (c.schedule(t), e()), u++, t(l));
              }
              let c = {
                schedule: (e, t = !1, r = !1) => {
                  let a = r && n ? i : s;
                  return (t && o.add(e), a.has(e) || a.add(e), e);
                },
                cancel: (e) => {
                  (s.delete(e), o.delete(e));
                },
                process: (e) => {
                  if (((l = e), n)) {
                    a = !0;
                    return;
                  }
                  ((n = !0),
                    ([i, s] = [s, i]),
                    i.forEach(h),
                    t && r.value && r.value.frameloop[t].push(u),
                    (u = 0),
                    i.clear(),
                    (n = !1),
                    a && ((a = !1), c.process(e)));
                },
              };
              return c;
            })(l, t ? i : void 0)),
            e
          ),
          {},
        ),
        {
          read: h,
          resolveKeyframes: c,
          update: p,
          preRender: d,
          render: m,
          postRender: f,
        } = u,
        g = () => {
          let n = i.MotionGlobalConfig.useManualTiming
            ? o.timestamp
            : performance.now();
          ((s = !1),
            i.MotionGlobalConfig.useManualTiming ||
              (o.delta = a
                ? 1e3 / 60
                : Math.max(Math.min(n - o.timestamp, 40), 1)),
            (o.timestamp = n),
            (o.isProcessing = !0),
            h.process(o),
            c.process(o),
            p.process(o),
            d.process(o),
            m.process(o),
            f.process(o),
            (o.isProcessing = !1),
            s && t && ((a = !1), e(g)));
        };
      return {
        schedule: n.reduce((t, i) => {
          let n = u[i];
          return (
            (t[i] = (t, i = !1, r = !1) => (
              !s && ((s = !0), (a = !0), o.isProcessing || e(g)),
              n.schedule(t, i, r)
            )),
            t
          );
        }, {}),
        cancel: (e) => {
          for (let t = 0; t < n.length; t++) u[n[t]].cancel(e);
        },
        state: o,
        steps: u,
      };
    })("u" > typeof requestAnimationFrame ? requestAnimationFrame : s.noop, !0);
    function h() {
      t = void 0;
    }
    e.s(["cancelFrame", 0, o, "frame", 0, a, "frameData", 0, l], 40591);
    let c = {
      now: () => (
        void 0 === t &&
          c.set(
            l.isProcessing || i.MotionGlobalConfig.useManualTiming
              ? l.timestamp
              : performance.now(),
          ),
        t
      ),
      set: (e) => {
        ((t = e), queueMicrotask(h));
      },
    };
    e.s(["time", 0, c], 10873);
  },
  83940,
  (e) => {
    "use strict";
    e.s([
      "addUniqueItem",
      0,
      function (e, t) {
        -1 === e.indexOf(t) && e.push(t);
      },
      "removeItem",
      0,
      function (e, t) {
        let i = e.indexOf(t);
        i > -1 && e.splice(i, 1);
      },
    ]);
  },
  75546,
  (e) => {
    "use strict";
    var t = e.i(83940);
    e.s([
      "SubscriptionManager",
      0,
      class {
        constructor() {
          this.subscriptions = [];
        }
        add(e) {
          return (
            (0, t.addUniqueItem)(this.subscriptions, e),
            () => (0, t.removeItem)(this.subscriptions, e)
          );
        }
        notify(e, t, i) {
          let s = this.subscriptions.length;
          if (s)
            if (1 === s) this.subscriptions[0](e, t, i);
            else
              for (let n = 0; n < s; n++) {
                let s = this.subscriptions[n];
                s && s(e, t, i);
              }
        }
        getSize() {
          return this.subscriptions.length;
        }
        clear() {
          this.subscriptions.length = 0;
        }
      },
    ]);
  },
  35653,
  (e) => {
    "use strict";
    e.s([
      "velocityPerSecond",
      0,
      function (e, t) {
        return t ? (1e3 / t) * e : 0;
      },
    ]);
  },
  59814,
  43245,
  (e) => {
    "use strict";
    e.i(78700);
    var t = e.i(10873),
      i = e.i(75546),
      s = e.i(35653),
      n = e.i(40591);
    let r = { current: void 0 };
    class a {
      constructor(e, i = {}) {
        ((this.version = "12.4.7"),
          (this.canTrackVelocity = null),
          (this.events = {}),
          (this.updateAndNotify = (e, i = !0) => {
            let s = t.time.now();
            (this.updatedAt !== s && this.setPrevFrameValue(),
              (this.prev = this.current),
              this.setCurrent(e),
              this.current !== this.prev &&
                this.events.change &&
                this.events.change.notify(this.current),
              i &&
                this.events.renderRequest &&
                this.events.renderRequest.notify(this.current));
          }),
          (this.hasAnimated = !1),
          this.setCurrent(e),
          (this.owner = i.owner));
      }
      setCurrent(e) {
        ((this.current = e),
          (this.updatedAt = t.time.now()),
          null === this.canTrackVelocity &&
            void 0 !== e &&
            (this.canTrackVelocity = !isNaN(parseFloat(this.current))));
      }
      setPrevFrameValue(e = this.current) {
        ((this.prevFrameValue = e), (this.prevUpdatedAt = this.updatedAt));
      }
      onChange(e) {
        return this.on("change", e);
      }
      on(e, t) {
        this.events[e] || (this.events[e] = new i.SubscriptionManager());
        let s = this.events[e].add(t);
        return "change" === e
          ? () => {
              (s(),
                n.frame.read(() => {
                  this.events.change.getSize() || this.stop();
                }));
            }
          : s;
      }
      clearListeners() {
        for (let e in this.events) this.events[e].clear();
      }
      attach(e, t) {
        ((this.passiveEffect = e), (this.stopPassiveEffect = t));
      }
      set(e, t = !0) {
        t && this.passiveEffect
          ? this.passiveEffect(e, this.updateAndNotify)
          : this.updateAndNotify(e, t);
      }
      setWithVelocity(e, t, i) {
        (this.set(t),
          (this.prev = void 0),
          (this.prevFrameValue = e),
          (this.prevUpdatedAt = this.updatedAt - i));
      }
      jump(e, t = !0) {
        (this.updateAndNotify(e),
          (this.prev = e),
          (this.prevUpdatedAt = this.prevFrameValue = void 0),
          t && this.stop(),
          this.stopPassiveEffect && this.stopPassiveEffect());
      }
      get() {
        return (r.current && r.current.push(this), this.current);
      }
      getPrevious() {
        return this.prev;
      }
      getVelocity() {
        let e = t.time.now();
        if (
          !this.canTrackVelocity ||
          void 0 === this.prevFrameValue ||
          e - this.updatedAt > 30
        )
          return 0;
        let i = Math.min(this.updatedAt - this.prevUpdatedAt, 30);
        return (0, s.velocityPerSecond)(
          parseFloat(this.current) - parseFloat(this.prevFrameValue),
          i,
        );
      }
      start(e) {
        return (
          this.stop(),
          new Promise((t) => {
            ((this.hasAnimated = !0),
              (this.animation = e(t)),
              this.events.animationStart &&
                this.events.animationStart.notify());
          }).then(() => {
            (this.events.animationComplete &&
              this.events.animationComplete.notify(),
              this.clearAnimation());
          })
        );
      }
      stop() {
        (this.animation &&
          (this.animation.stop(),
          this.events.animationCancel && this.events.animationCancel.notify()),
          this.clearAnimation());
      }
      isAnimating() {
        return !!this.animation;
      }
      clearAnimation() {
        delete this.animation;
      }
      destroy() {
        (this.clearListeners(),
          this.stop(),
          this.stopPassiveEffect && this.stopPassiveEffect());
      }
    }
    e.s(
      [
        "collectMotionValues",
        0,
        r,
        "motionValue",
        0,
        function (e, t) {
          return new a(e, t);
        },
      ],
      59814,
    );
    var o = e.i(25790);
    let l = (e) => {
        let t,
          i = new Set(),
          s = (e, s) => {
            let n = "function" == typeof e ? e(t) : e;
            if (!Object.is(n, t)) {
              let e = t;
              ((t = (null != s ? s : "object" != typeof n || null === n)
                ? n
                : Object.assign({}, t, n)),
                i.forEach((i) => i(t, e)));
            }
          },
          n = () => t,
          r = {
            setState: s,
            getState: n,
            getInitialState: () => a,
            subscribe: (e) => (i.add(e), () => i.delete(e)),
          },
          a = (t = e(s, n, r));
        return r;
      },
      u = (e) => {
        let t = e ? l(e) : l,
          i = (e) =>
            (function (e, t = (e) => e) {
              let i = o.default.useSyncExternalStore(
                e.subscribe,
                () => t(e.getState()),
                () => t(e.getInitialState()),
              );
              return (o.default.useDebugValue(i), i);
            })(t, e);
        return (Object.assign(i, t), i);
      };
    e.s(["create", 0, (e) => (e ? u(e) : u)], 43245);
  },
  15096,
  28375,
  (e) => {
    "use strict";
    function t(e) {
      let t;
      return () => (void 0 === t && (t = e()), t);
    }
    e.s(["memo", 0, t], 28375);
    let i = t(() => void 0 !== window.ScrollTimeline);
    class s {
      constructor(e) {
        ((this.stop = () => this.runAll("stop")),
          (this.animations = e.filter(Boolean)));
      }
      get finished() {
        return Promise.all(
          this.animations.map((e) => ("finished" in e ? e.finished : e)),
        );
      }
      getAll(e) {
        return this.animations[0][e];
      }
      setAll(e, t) {
        for (let i = 0; i < this.animations.length; i++)
          this.animations[i][e] = t;
      }
      attachTimeline(e, t) {
        let s = this.animations.map((s) =>
          i() && s.attachTimeline
            ? s.attachTimeline(e)
            : "function" == typeof t
              ? t(s)
              : void 0,
        );
        return () => {
          s.forEach((e, t) => {
            (e && e(), this.animations[t].stop());
          });
        };
      }
      get time() {
        return this.getAll("time");
      }
      set time(e) {
        this.setAll("time", e);
      }
      get speed() {
        return this.getAll("speed");
      }
      set speed(e) {
        this.setAll("speed", e);
      }
      get startTime() {
        return this.getAll("startTime");
      }
      get duration() {
        let e = 0;
        for (let t = 0; t < this.animations.length; t++)
          e = Math.max(e, this.animations[t].duration);
        return e;
      }
      runAll(e) {
        this.animations.forEach((t) => t[e]());
      }
      flatten() {
        this.runAll("flatten");
      }
      play() {
        this.runAll("play");
      }
      pause() {
        this.runAll("pause");
      }
      cancel() {
        this.runAll("cancel");
      }
      complete() {
        this.runAll("complete");
      }
    }
    e.s(
      [
        "GroupPlaybackControls",
        0,
        class extends s {
          then(e, t) {
            return Promise.all(this.animations).then(e).catch(t);
          }
        },
      ],
      15096,
    );
  },
  16323,
  43259,
  (e) => {
    "use strict";
    (e.s(
      [
        "millisecondsToSeconds",
        0,
        (e) => e / 1e3,
        "secondsToMilliseconds",
        0,
        (e) => 1e3 * e,
      ],
      16323,
    ),
      e.s(
        [
          "calcGeneratorDuration",
          0,
          function (e) {
            let t = 0,
              i = e.next(t);
            for (; !i.done && t < 2e4;) ((t += 50), (i = e.next(t)));
            return t >= 2e4 ? 1 / 0 : t;
          },
          "maxGeneratorDuration",
          0,
          2e4,
        ],
        43259,
      ));
  },
  4620,
  72618,
  (e) => {
    "use strict";
    let t = (e, t, i) => {
      let s = t - e;
      return 0 === s ? 1 : (i - e) / s;
    };
    (e.s(["progress", 0, t], 72618),
      e.s(
        [
          "generateLinearEasing",
          0,
          (e, i, s = 10) => {
            let n = "",
              r = Math.max(Math.round(i / s), 2);
            for (let i = 0; i < r; i++) n += e(t(0, r - 1, i)) + ", ";
            return `linear(${n.substring(0, n.length - 2)})`;
          },
        ],
        4620,
      ));
  },
  64196,
  (e) => {
    "use strict";
    e.s(["clamp", 0, (e, t, i) => (i > t ? t : i < e ? e : i)]);
  },
  1725,
  60306,
  (e) => {
    "use strict";
    var t = e.i(35653);
    (e.s(
      [
        "calcGeneratorVelocity",
        0,
        function (e, i, s) {
          let n = Math.max(i - 5, 0);
          return (0, t.velocityPerSecond)(s - e(n), i - n);
        },
      ],
      1725,
    ),
      e.s(
        [
          "springDefaults",
          0,
          {
            stiffness: 100,
            damping: 10,
            mass: 1,
            velocity: 0,
            duration: 800,
            bounce: 0.3,
            visualDuration: 0.3,
            restSpeed: { granular: 0.01, default: 2 },
            restDelta: { granular: 0.005, default: 0.5 },
            minDuration: 0.01,
            maxDuration: 10,
            minDamping: 0.05,
            maxDamping: 1,
          },
        ],
        60306,
      ));
  },
  4761,
  (e) => {
    "use strict";
    var t = e.i(91069);
    let i = t.noop,
      s = t.noop;
    e.s(["invariant", 0, s, "warning", 0, i]);
  },
  86240,
  (e) => {
    "use strict";
    var t = e.i(16323),
      i = e.i(43259),
      s = e.i(4620),
      n = e.i(64196),
      r = e.i(1725),
      a = e.i(60306),
      o = e.i(4761);
    function l(e, t) {
      return e * Math.sqrt(1 - t * t);
    }
    let u = ["duration", "bounce"],
      h = ["stiffness", "damping", "mass"];
    function c(e, t) {
      return t.some((t) => void 0 !== e[t]);
    }
    e.s(
      [
        "spring",
        0,
        function (
          e = a.springDefaults.visualDuration,
          p = a.springDefaults.bounce,
        ) {
          let d,
            m =
              "object" != typeof e
                ? { visualDuration: e, keyframes: [0, 1], bounce: p }
                : e,
            { restSpeed: f, restDelta: g } = m,
            v = m.keyframes[0],
            y = m.keyframes[m.keyframes.length - 1],
            b = { done: !1, value: v },
            {
              stiffness: S,
              damping: T,
              mass: V,
              duration: x,
              velocity: w,
              isResolvedFromDuration: M,
            } = (function (e) {
              let i = {
                velocity: a.springDefaults.velocity,
                stiffness: a.springDefaults.stiffness,
                damping: a.springDefaults.damping,
                mass: a.springDefaults.mass,
                isResolvedFromDuration: !1,
                ...e,
              };
              if (!c(e, h) && c(e, u))
                if (e.visualDuration) {
                  let t = (2 * Math.PI) / (1.2 * e.visualDuration),
                    s = t * t,
                    r =
                      2 *
                      (0, n.clamp)(0.05, 1, 1 - (e.bounce || 0)) *
                      Math.sqrt(s);
                  i = {
                    ...i,
                    mass: a.springDefaults.mass,
                    stiffness: s,
                    damping: r,
                  };
                } else {
                  let s = (function ({
                    duration: e = a.springDefaults.duration,
                    bounce: i = a.springDefaults.bounce,
                    velocity: s = a.springDefaults.velocity,
                    mass: r = a.springDefaults.mass,
                  }) {
                    let u, h;
                    (0, o.warning)(
                      e <=
                        (0, t.secondsToMilliseconds)(
                          a.springDefaults.maxDuration,
                        ),
                      "Spring duration must be 10 seconds or less",
                    );
                    let c = 1 - i;
                    ((c = (0, n.clamp)(
                      a.springDefaults.minDamping,
                      a.springDefaults.maxDamping,
                      c,
                    )),
                      (e = (0, n.clamp)(
                        a.springDefaults.minDuration,
                        a.springDefaults.maxDuration,
                        (0, t.millisecondsToSeconds)(e),
                      )),
                      c < 1
                        ? ((u = (t) => {
                            let i = t * c,
                              n = i * e;
                            return 0.001 - ((i - s) / l(t, c)) * Math.exp(-n);
                          }),
                          (h = (t) => {
                            let i = t * c * e,
                              n = Math.pow(c, 2) * Math.pow(t, 2) * e,
                              r = Math.exp(-i),
                              a = l(Math.pow(t, 2), c);
                            return (
                              ((i * s + s - n) *
                                r *
                                (-u(t) + 0.001 > 0 ? -1 : 1)) /
                              a
                            );
                          }))
                        : ((u = (t) =>
                            -0.001 + Math.exp(-t * e) * ((t - s) * e + 1)),
                          (h = (t) => e * e * (s - t) * Math.exp(-t * e))));
                    let p = (function (e, t, i) {
                      let s = i;
                      for (let i = 1; i < 12; i++) s -= e(s) / t(s);
                      return s;
                    })(u, h, 5 / e);
                    if (((e = (0, t.secondsToMilliseconds)(e)), isNaN(p)))
                      return {
                        stiffness: a.springDefaults.stiffness,
                        damping: a.springDefaults.damping,
                        duration: e,
                      };
                    {
                      let t = Math.pow(p, 2) * r;
                      return {
                        stiffness: t,
                        damping: 2 * c * Math.sqrt(r * t),
                        duration: e,
                      };
                    }
                  })(e);
                  (i = {
                    ...i,
                    ...s,
                    mass: a.springDefaults.mass,
                  }).isResolvedFromDuration = !0;
                }
              return i;
            })({
              ...m,
              velocity: -(0, t.millisecondsToSeconds)(m.velocity || 0),
            }),
            A = w || 0,
            P = T / (2 * Math.sqrt(S * V)),
            D = y - v,
            I = (0, t.millisecondsToSeconds)(Math.sqrt(S / V)),
            C = 5 > Math.abs(D);
          if (
            (f ||
              (f = C
                ? a.springDefaults.restSpeed.granular
                : a.springDefaults.restSpeed.default),
            g ||
              (g = C
                ? a.springDefaults.restDelta.granular
                : a.springDefaults.restDelta.default),
            P < 1)
          ) {
            let e = l(I, P);
            d = (t) =>
              y -
              Math.exp(-P * I * t) *
                (((A + P * I * D) / e) * Math.sin(e * t) + D * Math.cos(e * t));
          } else if (1 === P)
            d = (e) => y - Math.exp(-I * e) * (D + (A + I * D) * e);
          else {
            let e = I * Math.sqrt(P * P - 1);
            d = (t) => {
              let i = Math.exp(-P * I * t),
                s = Math.min(e * t, 300);
              return (
                y -
                (i * ((A + P * I * D) * Math.sinh(s) + e * D * Math.cosh(s))) /
                  e
              );
            };
          }
          let O = {
            calculatedDuration: (M && x) || null,
            next: (e) => {
              let i = d(e);
              if (M) b.done = e >= x;
              else {
                let s = 0;
                P < 1 &&
                  (s =
                    0 === e
                      ? (0, t.secondsToMilliseconds)(A)
                      : (0, r.calcGeneratorVelocity)(d, e, i));
                let n = Math.abs(y - i) <= g;
                b.done = Math.abs(s) <= f && n;
              }
              return ((b.value = b.done ? y : i), b);
            },
            toString: () => {
              let e = Math.min(
                  (0, i.calcGeneratorDuration)(O),
                  i.maxGeneratorDuration,
                ),
                t = (0, s.generateLinearEasing)(
                  (t) => O.next(e * t).value,
                  e,
                  30,
                );
              return e + "ms " + t;
            },
          };
          return O;
        },
      ],
      86240,
    );
  },
  72738,
  (e) => {
    "use strict";
    var t = e.i(16323),
      i = e.i(43259);
    e.s([
      "createGeneratorEasing",
      0,
      function (e, s = 100, n) {
        let r = n({ ...e, keyframes: [0, s] }),
          a = Math.min((0, i.calcGeneratorDuration)(r), i.maxGeneratorDuration);
        return {
          type: "keyframes",
          ease: (e) => r.next(a * e).value / s,
          duration: (0, t.millisecondsToSeconds)(a),
        };
      },
    ]);
  },
  85692,
  (e) => {
    "use strict";
    e.s([
      "isGenerator",
      0,
      function (e) {
        return "function" == typeof e;
      },
    ]);
  },
  18157,
  (e) => {
    "use strict";
    e.s([
      "wrap",
      0,
      (e, t, i) => {
        let s = t - e;
        return ((((i - e) % s) + s) % s) + e;
      },
    ]);
  },
  43150,
  (e) => {
    "use strict";
    e.s([
      "isEasingArray",
      0,
      (e) => Array.isArray(e) && "number" != typeof e[0],
    ]);
  },
  79442,
  (e) => {
    "use strict";
    var t = e.i(18157),
      i = e.i(43150);
    e.s([
      "getEasingForSegment",
      0,
      function (e, s) {
        return (0, i.isEasingArray)(e) ? e[(0, t.wrap)(0, e.length, s)] : e;
      },
    ]);
  },
  4944,
  (e) => {
    "use strict";
    e.s(["mixNumber", 0, (e, t, i) => e + (t - e) * i]);
  },
  12942,
  51108,
  (e) => {
    "use strict";
    var t = e.i(72618),
      i = e.i(4944);
    function s(e, s) {
      let n = e[e.length - 1];
      for (let r = 1; r <= s; r++) {
        let a = (0, t.progress)(0, s, r);
        e.push((0, i.mixNumber)(n, 1, a));
      }
    }
    (e.s(["fillOffset", 0, s], 51108),
      e.s(
        [
          "defaultOffset",
          0,
          function (e) {
            let t = [0];
            return (s(t, e.length - 1), t);
          },
        ],
        12942,
      ));
  },
  66011,
  (e) => {
    "use strict";
    e.s(["isMotionValue", 0, (e) => !!(e && e.getVelocity)]);
  },
  27451,
  72198,
  24048,
  10658,
  94819,
  (e) => {
    "use strict";
    var t = e.i(4761),
      i = e.i(72618),
      s = e.i(16323),
      n = e.i(72738),
      r = e.i(85692),
      a = e.i(79442),
      o = e.i(12942),
      l = e.i(51108),
      u = e.i(66011);
    function h(e) {
      return "object" == typeof e && !Array.isArray(e);
    }
    function c(e, t, i, s) {
      if ("string" == typeof e && h(t)) {
        var n;
        if (e instanceof EventTarget) return [e];
        if ("string" == typeof e) {
          let t = document;
          i && (t = i.current);
          let r =
            null != (n = null == s ? void 0 : s[e]) ? n : t.querySelectorAll(e);
          return r ? Array.from(r) : [];
        }
        return Array.from(e);
      }
      return e instanceof NodeList ? Array.from(e) : Array.isArray(e) ? e : [e];
    }
    function p(e, t, i, s) {
      var n;
      return "number" == typeof t
        ? t
        : t.startsWith("-") || t.startsWith("+")
          ? Math.max(0, e + parseFloat(t))
          : "<" === t
            ? i
            : null != (n = s.get(t))
              ? n
              : e;
    }
    (e.s(["isDOMKeyframes", 0, h], 72198),
      e.s(["resolveSubjects", 0, c], 24048));
    var d = e.i(83940),
      m = e.i(4944);
    function f(e, t) {
      return e.at !== t.at
        ? e.at - t.at
        : null === e.value
          ? 1
          : null === t.value
            ? -1
            : 0;
    }
    function g(e, t) {
      return (t.has(e) || t.set(e, {}), t.get(e));
    }
    function v(e, t) {
      return (t[e] || (t[e] = []), t[e]);
    }
    let y = (e) => "number" == typeof e,
      b = (e) => e.every(y);
    e.s(
      [
        "createAnimationsFromSequence",
        0,
        function (e, { defaultTransition: h = {}, ...y } = {}, S, T) {
          let V = h.duration || 0.3,
            x = new Map(),
            w = new Map(),
            M = {},
            A = new Map(),
            P = 0,
            D = 0,
            I = 0;
          for (let i = 0; i < e.length; i++) {
            let f = e[i];
            if ("string" == typeof f) {
              A.set(f, D);
              continue;
            }
            if (!Array.isArray(f)) {
              A.set(f.name, p(D, f.at, P, A));
              continue;
            }
            let [y, x, k = {}] = f;
            void 0 !== k.at && (D = p(D, k.at, P, A));
            let F = 0,
              E = (e, i, u, c = 0, p = 0) => {
                var f;
                let g = Array.isArray((f = e)) ? f : [f],
                  {
                    delay: v = 0,
                    times: y = (0, o.defaultOffset)(g),
                    type: S = "keyframes",
                    repeat: x,
                    repeatType: w,
                    repeatDelay: M = 0,
                    ...A
                  } = i,
                  { ease: P = h.ease || "easeOut", duration: C } = i,
                  O = "function" == typeof v ? v(c, p) : v,
                  k = g.length,
                  E = (0, r.isGenerator)(S) ? S : null == T ? void 0 : T[S];
                if (k <= 2 && E) {
                  let e = 100;
                  2 === k && b(g) && (e = Math.abs(g[1] - g[0]));
                  let t = { ...A };
                  void 0 !== C &&
                    (t.duration = (0, s.secondsToMilliseconds)(C));
                  let i = (0, n.createGeneratorEasing)(t, e, E);
                  ((P = i.ease), (C = i.duration));
                }
                null != C || (C = V);
                let R = D + O;
                1 === y.length && 0 === y[0] && (y[1] = 1);
                let B = y.length - g.length;
                if (
                  (B > 0 && (0, l.fillOffset)(y, B),
                  1 === g.length && g.unshift(null),
                  x)
                ) {
                  ((0, t.invariant)(
                    x < 20,
                    "Repeat count too high, must be less than 20",
                  ),
                    (C *= x + 1));
                  let e = [...g],
                    i = [...y],
                    s = [...(P = Array.isArray(P) ? [...P] : [P])];
                  for (let t = 0; t < x; t++) {
                    g.push(...e);
                    for (let n = 0; n < e.length; n++)
                      (y.push(i[n] + (t + 1)),
                        P.push(
                          0 === n
                            ? "linear"
                            : (0, a.getEasingForSegment)(s, n - 1),
                        ));
                  }
                  for (let e = 0; e < y.length; e++) y[e] = y[e] / (x + 1);
                }
                let N = R + C;
                (!(function (e, t, i, s, n, r) {
                  for (let t = 0; t < e.length; t++) {
                    let i = e[t];
                    i.at > n && i.at < r && ((0, d.removeItem)(e, i), t--);
                  }
                  for (let o = 0; o < t.length; o++)
                    e.push({
                      value: t[o],
                      at: (0, m.mixNumber)(n, r, s[o]),
                      easing: (0, a.getEasingForSegment)(i, o),
                    });
                })(u, g, P, y, R, N),
                  (F = Math.max(O + C, F)),
                  (I = Math.max(N, I)));
              };
            if ((0, u.isMotionValue)(y)) E(x, k, v("default", g(y, w)));
            else {
              let e = c(y, x, S, M),
                t = e.length;
              for (let i = 0; i < t; i++) {
                let s = g(e[i], w);
                for (let e in x) {
                  var C, O;
                  E(
                    x[e],
                    ((C = k),
                    (O = e),
                    C && C[O] ? { ...C, ...C[O] } : { ...C }),
                    v(e, s),
                    i,
                    t,
                  );
                }
              }
            }
            ((P = D), (D += F));
          }
          return (
            w.forEach((e, t) => {
              for (let s in e) {
                let n = e[s];
                n.sort(f);
                let r = [],
                  a = [],
                  o = [];
                for (let e = 0; e < n.length; e++) {
                  let { at: t, value: s, easing: l } = n[e];
                  (r.push(s),
                    a.push((0, i.progress)(0, I, t)),
                    o.push(l || "easeOut"));
                }
                (0 !== a[0] &&
                  (a.unshift(0), r.unshift(r[0]), o.unshift("easeInOut")),
                  1 !== a[a.length - 1] && (a.push(1), r.push(null)),
                  x.has(t) || x.set(t, { keyframes: {}, transition: {} }));
                let l = x.get(t);
                ((l.keyframes[s] = r),
                  (l.transition[s] = {
                    ...h,
                    duration: I,
                    ease: o,
                    times: a,
                    ...y,
                  }));
              }
            }),
            x
          );
        },
      ],
      27451,
    );
    let S = new WeakMap();
    (e.s(["visualElementStore", 0, S], 10658),
      e.s(
        [
          "getValueTransition",
          0,
          function (e, t) {
            return e ? e[t] || e.default || e : void 0;
          },
        ],
        94819,
      ));
  },
  31535,
  (e) => {
    "use strict";
    let t = [
        "transformPerspective",
        "x",
        "y",
        "z",
        "translateX",
        "translateY",
        "translateZ",
        "scale",
        "scaleX",
        "scaleY",
        "rotate",
        "rotateX",
        "rotateY",
        "rotateZ",
        "skew",
        "skewX",
        "skewY",
      ],
      i = new Set(t);
    e.s(["transformPropOrder", 0, t, "transformProps", 0, i]);
  },
  41814,
  32583,
  1170,
  17167,
  15495,
  38069,
  (e) => {
    "use strict";
    let t = new Set([
      "width",
      "height",
      "top",
      "left",
      "right",
      "bottom",
      ...e.i(31535).transformPropOrder,
    ]);
    e.s(["positionalKeys", 0, t], 41814);
    let i = (e) => (Array.isArray(e) ? e[e.length - 1] || 0 : e);
    var s = e.i(59814);
    function n(e) {
      let t = [{}, {}];
      return (
        null == e ||
          e.values.forEach((e, i) => {
            ((t[0][i] = e.get()), (t[1][i] = e.getVelocity()));
          }),
        t
      );
    }
    function r(e, t, i, s) {
      if ("function" == typeof t) {
        let [r, a] = n(s);
        t = t(void 0 !== i ? i : e.custom, r, a);
      }
      if (
        ("string" == typeof t && (t = e.variants && e.variants[t]),
        "function" == typeof t)
      ) {
        let [r, a] = n(s);
        t = t(void 0 !== i ? i : e.custom, r, a);
      }
      return t;
    }
    (e.s(["resolveVariantFromProps", 0, r], 32583),
      e.s(
        [
          "setTarget",
          0,
          function (e, t) {
            let n,
              {
                transitionEnd: a = {},
                transition: o = {},
                ...l
              } = r((n = e.getProps()), t, n.custom, e) || {};
            for (let t in (l = { ...l, ...a })) {
              let n = i(l[t]);
              e.hasValue(t)
                ? e.getValue(t).set(n)
                : e.addValue(t, (0, s.motionValue)(n));
            }
          },
        ],
        1170,
      ));
    var a = e.i(66011);
    e.s(
      [
        "addValueToWillChange",
        0,
        function (e, t) {
          let i = e.getValue("willChange");
          if ((0, a.isMotionValue)(i) && i.add) return i.add(t);
        },
      ],
      17167,
    );
    let o = (e) => e.replace(/([a-z])([A-Z])/gu, "$1-$2").toLowerCase();
    e.s(["camelToDash", 0, o], 15495);
    let l = "data-" + o("framerAppearId");
    e.s(
      [
        "getOptimisedAppearId",
        0,
        function (e) {
          return e.props[l];
        },
      ],
      38069,
    );
  },
  20523,
  (e) => {
    "use strict";
    e.s(["instantAnimationState", 0, { current: !1 }]);
  },
  19649,
  (e) => {
    "use strict";
    e.s([
      "attachTimeline",
      0,
      function (e, t) {
        ((e.timeline = t), (e.onfinish = null));
      },
    ]);
  },
  676,
  (e) => {
    "use strict";
    e.s([
      "isBezierDefinition",
      0,
      (e) => Array.isArray(e) && "number" == typeof e[0],
    ]);
  },
  36970,
  25111,
  (e) => {
    "use strict";
    let t;
    var i,
      s = e.i(676),
      n = e.i(28375);
    let r,
      a =
        ((i = () => {
          try {
            document
              .createElement("div")
              .animate({ opacity: 0 }, { easing: "linear(0, 1)" });
          } catch (e) {
            return !1;
          }
          return !0;
        }),
        (t = (0, n.memo)(i)),
        () => {
          var e;
          return null != (e = r) ? e : t();
        });
    e.s(["supportsLinearEasing", 0, a], 25111);
    var o = e.i(4620);
    let l = ([e, t, i, s]) => `cubic-bezier(${e}, ${t}, ${i}, ${s})`,
      u = {
        linear: "linear",
        ease: "ease",
        easeIn: "ease-in",
        easeOut: "ease-out",
        easeInOut: "ease-in-out",
        circIn: l([0, 0.65, 0.55, 1]),
        circOut: l([0.55, 0, 1, 0.45]),
        backIn: l([0.31, 0.01, 0.66, -0.59]),
        backOut: l([0.33, 1.53, 0.69, 0.99]),
      };
    e.s(
      [
        "isWaapiSupportedEasing",
        0,
        function e(t) {
          return !!(
            ("function" == typeof t && a()) ||
            !t ||
            ("string" == typeof t && (t in u || a())) ||
            (0, s.isBezierDefinition)(t) ||
            (Array.isArray(t) && t.every(e))
          );
        },
        "mapEasingToNativeEasing",
        0,
        function e(t, i) {
          if (t)
            return "function" == typeof t && a()
              ? (0, o.generateLinearEasing)(t, i)
              : (0, s.isBezierDefinition)(t)
                ? l(t)
                : Array.isArray(t)
                  ? t.map((t) => e(t, i) || u.easeOut)
                  : u[t];
        },
      ],
      36970,
    );
  },
  5115,
  (e) => {
    "use strict";
    var t = e.i(91069);
    let i = (e, t, i) =>
      (((1 - 3 * i + 3 * t) * e + (3 * i - 6 * t)) * e + 3 * t) * e;
    e.s([
      "cubicBezier",
      0,
      function (e, s, n, r) {
        return e === s && n === r
          ? t.noop
          : (t) =>
              0 === t || 1 === t
                ? t
                : i(
                    (function (e, t, s, n, r) {
                      let a,
                        o,
                        l = 0;
                      do
                        (a = i((o = t + (s - t) / 2), n, r) - e) > 0
                          ? (s = o)
                          : (t = o);
                      while (Math.abs(a) > 1e-7 && ++l < 12);
                      return o;
                    })(t, 0, 1, e, n),
                    s,
                    r,
                  );
      },
    ]);
  },
  78274,
  79769,
  5299,
  (e) => {
    "use strict";
    var t = e.i(5115);
    let i = (e) => (t) => (t <= 0.5 ? e(2 * t) / 2 : (2 - e(2 * (1 - t))) / 2),
      s = (e) => (t) => 1 - e(1 - t),
      n = (0, t.cubicBezier)(0.33, 1.53, 0.69, 0.99),
      r = s(n),
      a = i(r);
    (e.s(["backIn", 0, r, "backInOut", 0, a, "backOut", 0, n], 79769),
      e.s(
        [
          "anticipate",
          0,
          (e) =>
            (e *= 2) < 1 ? 0.5 * r(e) : 0.5 * (2 - Math.pow(2, -10 * (e - 1))),
        ],
        78274,
      ));
    let o = (e) => 1 - Math.sin(Math.acos(e)),
      l = s(o),
      u = i(o);
    e.s(["circIn", 0, o, "circInOut", 0, u, "circOut", 0, l], 5299);
  },
  1292,
  46581,
  (e) => {
    "use strict";
    let t = (e) => /^0[^.\s]+$/u.test(e);
    (e.s(["isZeroValueString", 0, t], 46581),
      e.s(
        [
          "isNone",
          0,
          function (e) {
            return "number" == typeof e
              ? 0 === e
              : null === e || "none" === e || "0" === e || t(e);
          },
        ],
        1292,
      ));
  },
  16632,
  (e) => {
    "use strict";
    var t = e.i(64196);
    let i = {
        test: (e) => "number" == typeof e,
        parse: parseFloat,
        transform: (e) => e,
      },
      s = { ...i, transform: (e) => (0, t.clamp)(0, 1, e) },
      n = { ...i, default: 1 };
    e.s(["alpha", 0, s, "number", 0, i, "scale", 0, n]);
  },
  25335,
  67405,
  83012,
  47246,
  85235,
  (e) => {
    "use strict";
    var t = e.i(64196),
      i = e.i(16632);
    let s = (e) => Math.round(1e5 * e) / 1e5;
    e.s(["sanitize", 0, s], 67405);
    let n = /-?(?:\d+(?:\.\d+)?|\.\d+)/gu;
    e.s(["floatRegex", 0, n], 83012);
    let r =
        /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))$/iu,
      a = (e, t) => (i) =>
        !!(
          ("string" == typeof i && r.test(i) && i.startsWith(e)) ||
          (t && null != i && Object.prototype.hasOwnProperty.call(i, t))
        ),
      o = (e, t, i) => (s) => {
        if ("string" != typeof s) return s;
        let [r, a, o, l] = s.match(n);
        return {
          [e]: parseFloat(r),
          [t]: parseFloat(a),
          [i]: parseFloat(o),
          alpha: void 0 !== l ? parseFloat(l) : 1,
        };
      };
    e.s(["isColorString", 0, a, "splitColor", 0, o], 47246);
    let l = {
        ...i.number,
        transform: (e) => Math.round((0, t.clamp)(0, 255, e)),
      },
      u = {
        test: a("rgb", "red"),
        parse: o("red", "green", "blue"),
        transform: ({ red: e, green: t, blue: n, alpha: r = 1 }) =>
          "rgba(" +
          l.transform(e) +
          ", " +
          l.transform(t) +
          ", " +
          l.transform(n) +
          ", " +
          s(i.alpha.transform(r)) +
          ")",
      };
    e.s(["rgba", 0, u], 85235);
    let h = {
      test: a("#"),
      parse: function (e) {
        let t = "",
          i = "",
          s = "",
          n = "";
        return (
          e.length > 5
            ? ((t = e.substring(1, 3)),
              (i = e.substring(3, 5)),
              (s = e.substring(5, 7)),
              (n = e.substring(7, 9)))
            : ((t = e.substring(1, 2)),
              (i = e.substring(2, 3)),
              (s = e.substring(3, 4)),
              (n = e.substring(4, 5)),
              (t += t),
              (i += i),
              (s += s),
              (n += n)),
          {
            red: parseInt(t, 16),
            green: parseInt(i, 16),
            blue: parseInt(s, 16),
            alpha: n ? parseInt(n, 16) / 255 : 1,
          }
        );
      },
      transform: u.transform,
    };
    e.s(["hex", 0, h], 25335);
  },
  17046,
  (e) => {
    "use strict";
    let t = (e) => ({
        test: (t) =>
          "string" == typeof t && t.endsWith(e) && 1 === t.split(" ").length,
        parse: parseFloat,
        transform: (t) => `${t}${e}`,
      }),
      i = t("deg"),
      s = t("%"),
      n = t("px"),
      r = t("vh"),
      a = t("vw"),
      o = {
        ...s,
        parse: (e) => s.parse(e) / 100,
        transform: (e) => s.transform(100 * e),
      };
    e.s([
      "degrees",
      0,
      i,
      "percent",
      0,
      s,
      "progressPercentage",
      0,
      o,
      "px",
      0,
      n,
      "vh",
      0,
      r,
      "vw",
      0,
      a,
    ]);
  },
  51488,
  (e) => {
    "use strict";
    var t = e.i(16632),
      i = e.i(17046),
      s = e.i(67405),
      n = e.i(47246);
    let r = {
      test: (0, n.isColorString)("hsl", "hue"),
      parse: (0, n.splitColor)("hue", "saturation", "lightness"),
      transform: ({ hue: e, saturation: n, lightness: r, alpha: a = 1 }) =>
        "hsla(" +
        Math.round(e) +
        ", " +
        i.percent.transform((0, s.sanitize)(n)) +
        ", " +
        i.percent.transform((0, s.sanitize)(r)) +
        ", " +
        (0, s.sanitize)(t.alpha.transform(a)) +
        ")",
    };
    e.s(["hsla", 0, r]);
  },
  55612,
  42406,
  (e) => {
    "use strict";
    var t = e.i(25335),
      i = e.i(51488),
      s = e.i(85235);
    let n = {
      test: (e) => s.rgba.test(e) || t.hex.test(e) || i.hsla.test(e),
      parse: (e) =>
        s.rgba.test(e)
          ? s.rgba.parse(e)
          : i.hsla.test(e)
            ? i.hsla.parse(e)
            : t.hex.parse(e),
      transform: (e) =>
        "string" == typeof e
          ? e
          : e.hasOwnProperty("red")
            ? s.rgba.transform(e)
            : i.hsla.transform(e),
    };
    e.s(["color", 0, n], 42406);
    let r =
      /(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))/giu;
    var a = e.i(83012),
      o = e.i(67405);
    let l = "number",
      u = "color",
      h =
        /var\s*\(\s*--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)|#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\)|-?(?:\d+(?:\.\d+)?|\.\d+)/giu;
    function c(e) {
      let t = e.toString(),
        i = [],
        s = { color: [], number: [], var: [] },
        r = [],
        a = 0,
        o = t
          .replace(
            h,
            (e) => (
              n.test(e)
                ? (s.color.push(a), r.push(u), i.push(n.parse(e)))
                : e.startsWith("var(")
                  ? (s.var.push(a), r.push("var"), i.push(e))
                  : (s.number.push(a), r.push(l), i.push(parseFloat(e))),
              ++a,
              "${}"
            ),
          )
          .split("${}");
      return { values: i, split: o, indexes: s, types: r };
    }
    function p(e) {
      return c(e).values;
    }
    function d(e) {
      let { split: t, types: i } = c(e),
        s = t.length;
      return (e) => {
        let r = "";
        for (let a = 0; a < s; a++)
          if (((r += t[a]), void 0 !== e[a])) {
            let t = i[a];
            t === l
              ? (r += (0, o.sanitize)(e[a]))
              : t === u
                ? (r += n.transform(e[a]))
                : (r += e[a]);
          }
        return r;
      };
    }
    let m = (e) => ("number" == typeof e ? 0 : e);
    e.s(
      [
        "analyseComplexValue",
        0,
        c,
        "complex",
        0,
        {
          test: function (e) {
            var t, i;
            return (
              isNaN(e) &&
              "string" == typeof e &&
              ((null == (t = e.match(a.floatRegex)) ? void 0 : t.length) || 0) +
                ((null == (i = e.match(r)) ? void 0 : i.length) || 0) >
                0
            );
          },
          parse: p,
          createTransformer: d,
          getAnimatableNone: function (e) {
            let t = p(e);
            return d(e)(t.map(m));
          },
        },
      ],
      55612,
    );
  },
  80195,
  10097,
  85116,
  7537,
  (e) => {
    "use strict";
    var t = e.i(55612),
      i = e.i(83012);
    let s = new Set(["brightness", "contrast", "saturate", "opacity"]);
    function n(e) {
      let [t, n] = e.slice(0, -1).split("(");
      if ("drop-shadow" === t) return e;
      let [r] = n.match(i.floatRegex) || [];
      if (!r) return e;
      let a = n.replace(r, ""),
        o = +!!s.has(t);
      return (r !== n && (o *= 100), t + "(" + o + a + ")");
    }
    let r = /\b([a-z-]*)\(.*?\)/gu,
      a = {
        ...t.complex,
        getAnimatableNone: (e) => {
          let t = e.match(r);
          return t ? t.map(n).join(" ") : e;
        },
      };
    var o = e.i(42406),
      l = e.i(16632),
      u = e.i(17046);
    let h = {
        borderWidth: u.px,
        borderTopWidth: u.px,
        borderRightWidth: u.px,
        borderBottomWidth: u.px,
        borderLeftWidth: u.px,
        borderRadius: u.px,
        radius: u.px,
        borderTopLeftRadius: u.px,
        borderTopRightRadius: u.px,
        borderBottomRightRadius: u.px,
        borderBottomLeftRadius: u.px,
        width: u.px,
        maxWidth: u.px,
        height: u.px,
        maxHeight: u.px,
        top: u.px,
        right: u.px,
        bottom: u.px,
        left: u.px,
        padding: u.px,
        paddingTop: u.px,
        paddingRight: u.px,
        paddingBottom: u.px,
        paddingLeft: u.px,
        margin: u.px,
        marginTop: u.px,
        marginRight: u.px,
        marginBottom: u.px,
        marginLeft: u.px,
        backgroundPositionX: u.px,
        backgroundPositionY: u.px,
      },
      c = {
        rotate: u.degrees,
        rotateX: u.degrees,
        rotateY: u.degrees,
        rotateZ: u.degrees,
        scale: l.scale,
        scaleX: l.scale,
        scaleY: l.scale,
        scaleZ: l.scale,
        skew: u.degrees,
        skewX: u.degrees,
        skewY: u.degrees,
        distance: u.px,
        translateX: u.px,
        translateY: u.px,
        translateZ: u.px,
        x: u.px,
        y: u.px,
        z: u.px,
        perspective: u.px,
        transformPerspective: u.px,
        opacity: l.alpha,
        originX: u.progressPercentage,
        originY: u.progressPercentage,
        originZ: u.px,
      },
      p = { ...l.number, transform: Math.round },
      d = {
        ...h,
        ...c,
        zIndex: p,
        size: u.px,
        fillOpacity: l.alpha,
        strokeOpacity: l.alpha,
        numOctaves: p,
      };
    e.s(["numberValueTypes", 0, d], 10097);
    let m = {
        ...d,
        color: o.color,
        backgroundColor: o.color,
        outlineColor: o.color,
        fill: o.color,
        stroke: o.color,
        borderColor: o.color,
        borderTopColor: o.color,
        borderRightColor: o.color,
        borderBottomColor: o.color,
        borderLeftColor: o.color,
        filter: a,
        WebkitFilter: a,
      },
      f = (e) => m[e];
    function g(e, i) {
      let s = f(e);
      return (
        s !== a && (s = t.complex),
        s.getAnimatableNone ? s.getAnimatableNone(i) : void 0
      );
    }
    (e.s(["getDefaultValueType", 0, f], 85116),
      e.s(["getAnimatableNone", 0, g], 7537));
    let v = new Set(["auto", "none", "0"]);
    e.s(
      [
        "makeNoneKeyframesAnimatable",
        0,
        function (e, i, s) {
          let n,
            r = 0;
          for (; r < e.length && !n;) {
            let i = e[r];
            ("string" == typeof i &&
              !v.has(i) &&
              (0, t.analyseComplexValue)(i).values.length &&
              (n = e[r]),
              r++);
          }
          if (n && s) for (let t of i) e[t] = g(s, n);
        },
      ],
      80195,
    );
  },
  96430,
  93557,
  (e) => {
    "use strict";
    var t = e.i(16632),
      i = e.i(17046),
      s = e.i(31535);
    let n = (e, t) => parseFloat(e.split(", ")[t]),
      r =
        (e, t) =>
        (i, { transform: s }) => {
          if ("none" === s || !s) return 0;
          let r = s.match(/^matrix3d\((.+)\)$/u);
          if (r) return n(r[1], t);
          {
            let t = s.match(/^matrix\((.+)\)$/u);
            return t ? n(t[1], e) : 0;
          }
        },
      a = new Set(["x", "y", "z"]),
      o = s.transformPropOrder.filter((e) => !a.has(e));
    function l(e) {
      let t = [];
      return (
        o.forEach((i) => {
          let s = e.getValue(i);
          void 0 !== s &&
            (t.push([i, s.get()]), s.set(+!!i.startsWith("scale")));
        }),
        t
      );
    }
    let u = {
      width: ({ x: e }, { paddingLeft: t = "0", paddingRight: i = "0" }) =>
        e.max - e.min - parseFloat(t) - parseFloat(i),
      height: ({ y: e }, { paddingTop: t = "0", paddingBottom: i = "0" }) =>
        e.max - e.min - parseFloat(t) - parseFloat(i),
      top: (e, { top: t }) => parseFloat(t),
      left: (e, { left: t }) => parseFloat(t),
      bottom: ({ y: e }, { top: t }) => parseFloat(t) + (e.max - e.min),
      right: ({ x: e }, { left: t }) => parseFloat(t) + (e.max - e.min),
      x: r(4, 13),
      y: r(5, 14),
    };
    ((u.translateX = u.x),
      (u.translateY = u.y),
      e.s(
        [
          "isNumOrPxType",
          0,
          (e) => e === t.number || e === i.px,
          "positionalValues",
          0,
          u,
          "removeNonTranslationalTransform",
          0,
          l,
        ],
        93557,
      ));
    var h = e.i(40591);
    let c = new Set(),
      p = !1,
      d = !1;
    function m() {
      if (d) {
        let e = Array.from(c).filter((e) => e.needsMeasurement),
          t = new Set(e.map((e) => e.element)),
          i = new Map();
        (t.forEach((e) => {
          let t = l(e);
          t.length && (i.set(e, t), e.render());
        }),
          e.forEach((e) => e.measureInitialState()),
          t.forEach((e) => {
            e.render();
            let t = i.get(e);
            t &&
              t.forEach(([t, i]) => {
                var s;
                null == (s = e.getValue(t)) || s.set(i);
              });
          }),
          e.forEach((e) => e.measureEndState()),
          e.forEach((e) => {
            void 0 !== e.suspendedScrollY &&
              window.scrollTo(0, e.suspendedScrollY);
          }));
      }
      ((d = !1), (p = !1), c.forEach((e) => e.complete()), c.clear());
    }
    function f() {
      c.forEach((e) => {
        (e.readKeyframes(), e.needsMeasurement && (d = !0));
      });
    }
    e.s(
      [
        "KeyframeResolver",
        0,
        class {
          constructor(e, t, i, s, n, r = !1) {
            ((this.isComplete = !1),
              (this.isAsync = !1),
              (this.needsMeasurement = !1),
              (this.isScheduled = !1),
              (this.unresolvedKeyframes = [...e]),
              (this.onComplete = t),
              (this.name = i),
              (this.motionValue = s),
              (this.element = n),
              (this.isAsync = r));
          }
          scheduleResolve() {
            ((this.isScheduled = !0),
              this.isAsync
                ? (c.add(this),
                  p || ((p = !0), h.frame.read(f), h.frame.resolveKeyframes(m)))
                : (this.readKeyframes(), this.complete()));
          }
          readKeyframes() {
            let {
              unresolvedKeyframes: e,
              name: t,
              element: i,
              motionValue: s,
            } = this;
            for (let n = 0; n < e.length; n++)
              if (null === e[n])
                if (0 === n) {
                  let n = null == s ? void 0 : s.get(),
                    r = e[e.length - 1];
                  if (void 0 !== n) e[0] = n;
                  else if (i && t) {
                    let s = i.readValue(t, r);
                    null != s && (e[0] = s);
                  }
                  (void 0 === e[0] && (e[0] = r),
                    s && void 0 === n && s.set(e[0]));
                } else e[n] = e[n - 1];
          }
          setFinalKeyframe() {}
          measureInitialState() {}
          renderEndStyles() {}
          measureEndState() {}
          complete() {
            ((this.isComplete = !0),
              this.onComplete(this.unresolvedKeyframes, this.finalKeyframe),
              c.delete(this));
          }
          cancel() {
            this.isComplete || ((this.isScheduled = !1), c.delete(this));
          }
          resume() {
            this.isComplete || this.scheduleResolve();
          }
        },
        "flushKeyframeResolvers",
        0,
        function () {
          (f(), m());
        },
      ],
      96430,
    );
  },
  74199,
  (e) => {
    "use strict";
    e.s([
      "isNumericalString",
      0,
      (e) => /^-?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(e),
    ]);
  },
  88622,
  (e) => {
    "use strict";
    let t = (e) => (t) => "string" == typeof t && t.startsWith(e),
      i = t("--"),
      s = t("var(--"),
      n =
        /var\(--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)$/iu;
    e.s([
      "isCSSVariableName",
      0,
      i,
      "isCSSVariableToken",
      0,
      (e) => !!s(e) && n.test(e.split("/*")[0].trim()),
    ]);
  },
  36276,
  42504,
  43489,
  (e) => {
    "use strict";
    var t = e.i(1292),
      i = e.i(41814),
      s = e.i(80195),
      n = e.i(96430),
      r = e.i(4761),
      a = e.i(74199),
      o = e.i(88622);
    let l = /^var\(--(?:([\w-]+)|([\w-]+), ?([a-zA-Z\d ()%#.,-]+))\)/u;
    var u = e.i(93557),
      h = e.i(16632),
      c = e.i(17046);
    let p = (e) => (t) => t.test(e);
    e.s(["testValueType", 0, p], 42504);
    let d = [
        h.number,
        c.px,
        c.percent,
        c.degrees,
        c.vw,
        c.vh,
        { test: (e) => "auto" === e, parse: (e) => e },
      ],
      m = (e) => d.find(p(e));
    e.s(["dimensionValueTypes", 0, d, "findDimensionValueType", 0, m], 43489);
    class f extends n.KeyframeResolver {
      constructor(e, t, i, s, n) {
        super(e, t, i, s, n, !0);
      }
      readKeyframes() {
        let { unresolvedKeyframes: e, element: t, name: s } = this;
        if (!t || !t.current) return;
        super.readKeyframes();
        for (let i = 0; i < e.length; i++) {
          let s = e[i];
          if (
            "string" == typeof s &&
            ((s = s.trim()), (0, o.isCSSVariableToken)(s))
          ) {
            let n = (function e(t, i, s = 1) {
              (0, r.invariant)(
                s <= 4,
                `Max CSS variable fallback depth detected in property "${t}". This may indicate a circular fallback dependency.`,
              );
              let [n, u] = (function (e) {
                let t = l.exec(e);
                if (!t) return [,];
                let [, i, s, n] = t;
                return [`--${null != i ? i : s}`, n];
              })(t);
              if (!n) return;
              let h = window.getComputedStyle(i).getPropertyValue(n);
              if (h) {
                let e = h.trim();
                return (0, a.isNumericalString)(e) ? parseFloat(e) : e;
              }
              return (0, o.isCSSVariableToken)(u) ? e(u, i, s + 1) : u;
            })(s, t.current);
            (void 0 !== n && (e[i] = n),
              i === e.length - 1 && (this.finalKeyframe = s));
          }
        }
        if (
          (this.resolveNoneKeyframes(),
          !i.positionalKeys.has(s) || 2 !== e.length)
        )
          return;
        let [n, h] = e,
          c = m(n),
          p = m(h);
        if (c !== p)
          if ((0, u.isNumOrPxType)(c) && (0, u.isNumOrPxType)(p))
            for (let t = 0; t < e.length; t++) {
              let i = e[t];
              "string" == typeof i && (e[t] = parseFloat(i));
            }
          else this.needsMeasurement = !0;
      }
      resolveNoneKeyframes() {
        let { unresolvedKeyframes: e, name: i } = this,
          n = [];
        for (let i = 0; i < e.length; i++) (0, t.isNone)(e[i]) && n.push(i);
        n.length && (0, s.makeNoneKeyframesAnimatable)(e, n, i);
      }
      measureInitialState() {
        let { element: e, unresolvedKeyframes: t, name: i } = this;
        if (!e || !e.current) return;
        ("height" === i && (this.suspendedScrollY = window.pageYOffset),
          (this.measuredOrigin = u.positionalValues[i](
            e.measureViewportBox(),
            window.getComputedStyle(e.current),
          )),
          (t[0] = this.measuredOrigin));
        let s = t[t.length - 1];
        void 0 !== s && e.getValue(i, s).jump(s, !1);
      }
      measureEndState() {
        var e;
        let { element: t, name: i, unresolvedKeyframes: s } = this;
        if (!t || !t.current) return;
        let n = t.getValue(i);
        n && n.jump(this.measuredOrigin, !1);
        let r = s.length - 1,
          a = s[r];
        ((s[r] = u.positionalValues[i](
          t.measureViewportBox(),
          window.getComputedStyle(t.current),
        )),
          null !== a &&
            void 0 === this.finalKeyframe &&
            (this.finalKeyframe = a),
          (null == (e = this.removedTransforms) ? void 0 : e.length) &&
            this.removedTransforms.forEach(([e, i]) => {
              t.getValue(e).set(i);
            }),
          this.resolveNoneKeyframes());
      }
    }
    e.s(["DOMKeyframesResolver", 0, f], 36276);
  },
  96561,
  64605,
  (e) => {
    "use strict";
    var t = e.i(10873),
      i = e.i(96430),
      s = e.i(20523),
      n = e.i(4761),
      r = e.i(85692),
      a = e.i(55612);
    let o = (e, t) =>
        "zIndex" !== t &&
        !!(
          "number" == typeof e ||
          Array.isArray(e) ||
          ("string" == typeof e &&
            (a.complex.test(e) || "0" === e) &&
            !e.startsWith("url("))
        ),
      l = (e) => null !== e;
    function u(e, { repeat: t, repeatType: i = "loop" }, s) {
      let n = e.filter(l),
        r = t && "loop" !== i && t % 2 == 1 ? 0 : n.length - 1;
      return r && void 0 !== s ? s : n[r];
    }
    (e.s(["getFinalKeyframe", 0, u], 64605),
      e.s(
        [
          "BaseAnimation",
          0,
          class {
            constructor({
              autoplay: e = !0,
              delay: i = 0,
              type: s = "keyframes",
              repeat: n = 0,
              repeatDelay: r = 0,
              repeatType: a = "loop",
              ...o
            }) {
              ((this.isStopped = !1),
                (this.hasAttemptedResolve = !1),
                (this.createdAt = t.time.now()),
                (this.options = {
                  autoplay: e,
                  delay: i,
                  type: s,
                  repeat: n,
                  repeatDelay: r,
                  repeatType: a,
                  ...o,
                }),
                this.updateFinishedPromise());
            }
            calcStartTime() {
              return this.resolvedAt && this.resolvedAt - this.createdAt > 40
                ? this.resolvedAt
                : this.createdAt;
            }
            get resolved() {
              return (
                this._resolved ||
                  this.hasAttemptedResolve ||
                  (0, i.flushKeyframeResolvers)(),
                this._resolved
              );
            }
            onKeyframesResolved(e, i) {
              ((this.resolvedAt = t.time.now()),
                (this.hasAttemptedResolve = !0));
              let {
                name: a,
                type: l,
                velocity: h,
                delay: c,
                onComplete: p,
                onUpdate: d,
                isGenerator: m,
              } = this.options;
              if (
                !m &&
                !(function (e, t, i, s) {
                  let a = e[0];
                  if (null === a) return !1;
                  if ("display" === t || "visibility" === t) return !0;
                  let l = e[e.length - 1],
                    u = o(a, t),
                    h = o(l, t);
                  return (
                    (0, n.warning)(
                      u === h,
                      `You are trying to animate ${t} from "${a}" to "${l}". ${a} is not an animatable value - to enable this animation set ${a} to a value animatable to ${l} via the \`style\` property.`,
                    ),
                    !!u &&
                      !!h &&
                      ((function (e) {
                        let t = e[0];
                        if (1 === e.length) return !0;
                        for (let i = 0; i < e.length; i++)
                          if (e[i] !== t) return !0;
                      })(e) ||
                        (("spring" === i || (0, r.isGenerator)(i)) && s))
                  );
                })(e, a, l, h)
              )
                if (s.instantAnimationState.current || !c) {
                  (d && d(u(e, this.options, i)),
                    p && p(),
                    this.resolveFinishedPromise());
                  return;
                } else this.options.duration = 0;
              let f = this.initPlayback(e, i);
              !1 !== f &&
                ((this._resolved = { keyframes: e, finalKeyframe: i, ...f }),
                this.onPostResolved());
            }
            onPostResolved() {}
            then(e, t) {
              return this.currentFinishedPromise.then(e, t);
            }
            flatten() {
              ((this.options.type = "keyframes"),
                (this.options.ease = "linear"));
            }
            updateFinishedPromise() {
              this.currentFinishedPromise = new Promise((e) => {
                this.resolveFinishedPromise = e;
              });
            }
          },
        ],
        96561,
      ));
  },
  27581,
  (e) => {
    "use strict";
    e.s(["activeAnimations", 0, { layout: 0, mainThread: 0, waapi: 0 }]);
  },
  72729,
  (e) => {
    "use strict";
    function t(e, t, i) {
      return (i < 0 && (i += 1), i > 1 && (i -= 1), i < 1 / 6)
        ? e + (t - e) * 6 * i
        : i < 0.5
          ? t
          : i < 2 / 3
            ? e + (t - e) * (2 / 3 - i) * 6
            : e;
    }
    e.s([
      "hslaToRgba",
      0,
      function ({ hue: e, saturation: i, lightness: s, alpha: n }) {
        ((e /= 360), (s /= 100));
        let r = 0,
          a = 0,
          o = 0;
        if ((i /= 100)) {
          let n = s < 0.5 ? s * (1 + i) : s + i - s * i,
            l = 2 * s - n;
          ((r = t(l, n, e + 1 / 3)),
            (a = t(l, n, e)),
            (o = t(l, n, e - 1 / 3)));
        } else r = a = o = s;
        return {
          red: Math.round(255 * r),
          green: Math.round(255 * a),
          blue: Math.round(255 * o),
          alpha: n,
        };
      },
    ]);
  },
  67963,
  38563,
  17237,
  (e) => {
    "use strict";
    var t = e.i(4944),
      i = e.i(4761),
      s = e.i(72729),
      n = e.i(25335),
      r = e.i(85235),
      a = e.i(51488);
    function o(e, t) {
      return (i) => (i > 0 ? t : e);
    }
    e.s(["mixImmediate", 0, o], 38563);
    let l = (e, t, i) => {
        let s = e * e,
          n = i * (t * t - s) + s;
        return n < 0 ? 0 : Math.sqrt(n);
      },
      u = [n.hex, r.rgba, a.hsla];
    function h(e) {
      let t = u.find((t) => t.test(e));
      if (
        ((0, i.warning)(
          !!t,
          `'${e}' is not an animatable color. Use the equivalent color code instead.`,
        ),
        !t)
      )
        return !1;
      let n = t.parse(e);
      return (t === a.hsla && (n = (0, s.hslaToRgba)(n)), n);
    }
    e.s(
      [
        "mixColor",
        0,
        (e, i) => {
          let s = h(e),
            n = h(i);
          if (!s || !n) return o(e, i);
          let a = { ...s };
          return (e) => (
            (a.red = l(s.red, n.red, e)),
            (a.green = l(s.green, n.green, e)),
            (a.blue = l(s.blue, n.blue, e)),
            (a.alpha = (0, t.mixNumber)(s.alpha, n.alpha, e)),
            r.rgba.transform(a)
          );
        },
      ],
      67963,
    );
    let c = (e, t) => (i) => t(e(i));
    e.s(["pipe", 0, (...e) => e.reduce(c)], 17237);
  },
  17428,
  (e) => {
    "use strict";
    var t = e.i(4944),
      i = e.i(67963),
      s = e.i(17237),
      n = e.i(4761),
      r = e.i(42406),
      a = e.i(55612),
      o = e.i(88622);
    let l = new Set(["none", "hidden"]);
    var u = e.i(38563);
    function h(e, i) {
      return (s) => (0, t.mixNumber)(e, i, s);
    }
    function c(e) {
      return "number" == typeof e
        ? h
        : "string" == typeof e
          ? (0, o.isCSSVariableToken)(e)
            ? u.mixImmediate
            : r.color.test(e)
              ? i.mixColor
              : m
          : Array.isArray(e)
            ? p
            : "object" == typeof e
              ? r.color.test(e)
                ? i.mixColor
                : d
              : u.mixImmediate;
    }
    function p(e, t) {
      let i = [...e],
        s = i.length,
        n = e.map((e, i) => c(e)(e, t[i]));
      return (e) => {
        for (let t = 0; t < s; t++) i[t] = n[t](e);
        return i;
      };
    }
    function d(e, t) {
      let i = { ...e, ...t },
        s = {};
      for (let n in i)
        void 0 !== e[n] && void 0 !== t[n] && (s[n] = c(e[n])(e[n], t[n]));
      return (e) => {
        for (let t in s) i[t] = s[t](e);
        return i;
      };
    }
    let m = (e, t) => {
      let i = a.complex.createTransformer(t),
        r = (0, a.analyseComplexValue)(e),
        o = (0, a.analyseComplexValue)(t);
      if (!(
        r.indexes.var.length === o.indexes.var.length &&
        r.indexes.color.length === o.indexes.color.length &&
        r.indexes.number.length >= o.indexes.number.length
      ))
        return (
          (0, n.warning)(
            !0,
            `Complex values '${e}' and '${t}' too different to mix. Ensure all colors are of the same type, and that each contains the same quantity of number and color values. Falling back to instant transition.`,
          ),
          (0, u.mixImmediate)(e, t)
        );
      if ((l.has(e) && !o.values.length) || (l.has(t) && !r.values.length))
        return l.has(e) ? (i) => (i <= 0 ? e : t) : (i) => (i >= 1 ? t : e);
      return (0, s.pipe)(
        p(
          (function (e, t) {
            var i;
            let s = [],
              n = { color: 0, var: 0, number: 0 };
            for (let r = 0; r < t.values.length; r++) {
              let a = t.types[r],
                o = e.indexes[a][n[a]],
                l = null != (i = e.values[o]) ? i : 0;
              ((s[r] = l), n[a]++);
            }
            return s;
          })(r, o),
          o.values,
        ),
        i,
      );
    };
    e.s(
      [
        "mix",
        0,
        function (e, i, s) {
          return "number" == typeof e &&
            "number" == typeof i &&
            "number" == typeof s
            ? (0, t.mixNumber)(e, i, s)
            : c(e)(e, i);
        },
      ],
      17428,
    );
  },
  25113,
  (e) => {
    "use strict";
    var t = e.i(86240),
      i = e.i(1725);
    e.s([
      "inertia",
      0,
      function ({
        keyframes: e,
        velocity: s = 0,
        power: n = 0.8,
        timeConstant: r = 325,
        bounceDamping: a = 10,
        bounceStiffness: o = 500,
        modifyTarget: l,
        min: u,
        max: h,
        restDelta: c = 0.5,
        restSpeed: p,
      }) {
        let d,
          m,
          f = e[0],
          g = { done: !1, value: f },
          v = n * s,
          y = f + v,
          b = void 0 === l ? y : l(y);
        b !== y && (v = b - f);
        let S = (e) => -v * Math.exp(-e / r),
          T = (e) => b + S(e),
          V = (e) => {
            let t = S(e),
              i = T(e);
            ((g.done = Math.abs(t) <= c), (g.value = g.done ? b : i));
          },
          x = (e) => {
            let s;
            if (
              ((s = g.value),
              (void 0 !== u && s < u) || (void 0 !== h && s > h))
            ) {
              var n;
              ((d = e),
                (m = (0, t.spring)({
                  keyframes: [
                    g.value,
                    ((n = g.value),
                    void 0 === u
                      ? h
                      : void 0 === h || Math.abs(u - n) < Math.abs(h - n)
                        ? u
                        : h),
                  ],
                  velocity: (0, i.calcGeneratorVelocity)(T, e, g.value),
                  damping: a,
                  stiffness: o,
                  restDelta: c,
                  restSpeed: p,
                })));
            }
          };
        return (
          x(0),
          {
            calculatedDuration: null,
            next: (e) => {
              let t = !1;
              return (m || void 0 !== d || ((t = !0), V(e), x(e)),
              void 0 !== d && e >= d)
                ? m.next(e - d)
                : (t || V(e), g);
            },
          }
        );
      },
    ]);
  },
  78633,
  (e) => {
    "use strict";
    var t = e.i(5115);
    let i = (0, t.cubicBezier)(0.42, 0, 1, 1),
      s = (0, t.cubicBezier)(0, 0, 0.58, 1),
      n = (0, t.cubicBezier)(0.42, 0, 0.58, 1);
    e.s(["easeIn", 0, i, "easeInOut", 0, n, "easeOut", 0, s]);
  },
  30683,
  32530,
  (e) => {
    "use strict";
    var t = e.i(4761),
      i = e.i(91069),
      s = e.i(676),
      n = e.i(78274),
      r = e.i(79769),
      a = e.i(5299),
      o = e.i(5115),
      l = e.i(78633);
    let u = {
      linear: i.noop,
      easeIn: l.easeIn,
      easeInOut: l.easeInOut,
      easeOut: l.easeOut,
      circIn: a.circIn,
      circInOut: a.circInOut,
      circOut: a.circOut,
      backIn: r.backIn,
      backInOut: r.backInOut,
      backOut: r.backOut,
      anticipate: n.anticipate,
    };
    e.s(
      [
        "easingDefinitionToFunction",
        0,
        (e) => {
          if ((0, s.isBezierDefinition)(e)) {
            (0, t.invariant)(
              4 === e.length,
              "Cubic bezier arrays must contain four numerical values.",
            );
            let [i, s, n, r] = e;
            return (0, o.cubicBezier)(i, s, n, r);
          }
          return "string" == typeof e
            ? ((0, t.invariant)(void 0 !== u[e], `Invalid easing type '${e}'`),
              u[e])
            : e;
        },
      ],
      30683,
    );
    var h = e.i(72618),
      c = e.i(64196),
      p = e.i(17428),
      d = e.i(17237);
    e.s(
      [
        "interpolate",
        0,
        function (e, s, { clamp: n = !0, ease: r, mixer: a } = {}) {
          let o = e.length;
          if (
            ((0, t.invariant)(
              o === s.length,
              "Both input and output ranges must be the same length",
            ),
            1 === o)
          )
            return () => s[0];
          if (2 === o && s[0] === s[1]) return () => s[1];
          let l = e[0] === e[1];
          e[0] > e[o - 1] && ((e = [...e].reverse()), (s = [...s].reverse()));
          let u = (function (e, t, s) {
              let n = [],
                r = s || p.mix,
                a = e.length - 1;
              for (let s = 0; s < a; s++) {
                let a = r(e[s], e[s + 1]);
                if (t) {
                  let e = Array.isArray(t) ? t[s] || i.noop : t;
                  a = (0, d.pipe)(e, a);
                }
                n.push(a);
              }
              return n;
            })(s, r, a),
            m = u.length,
            f = (t) => {
              if (l && t < e[0]) return s[0];
              let i = 0;
              if (m > 1) for (; i < e.length - 2 && !(t < e[i + 1]); i++);
              let n = (0, h.progress)(e[i], e[i + 1], t);
              return u[i](n);
            };
          return n ? (t) => f((0, c.clamp)(e[0], e[o - 1], t)) : f;
        },
      ],
      32530,
    );
  },
  31112,
  (e) => {
    "use strict";
    var t = e.i(78633),
      i = e.i(43150),
      s = e.i(30683),
      n = e.i(32530),
      r = e.i(12942);
    e.s(
      [
        "keyframes",
        0,
        function ({
          duration: e = 300,
          keyframes: a,
          times: o,
          ease: l = "easeInOut",
        }) {
          var u;
          let h = (0, i.isEasingArray)(l)
              ? l.map(s.easingDefinitionToFunction)
              : (0, s.easingDefinitionToFunction)(l),
            c = { done: !1, value: a[0] },
            p =
              ((u = o && o.length === a.length ? o : (0, r.defaultOffset)(a)),
              u.map((t) => t * e)),
            d = (0, n.interpolate)(p, a, {
              ease: Array.isArray(h)
                ? h
                : a.map(() => h || t.easeInOut).splice(0, a.length - 1),
            });
          return {
            calculatedDuration: e,
            next: (t) => ((c.value = d(t)), (c.done = t >= e), c),
          };
        },
      ],
      31112,
    );
  },
  42036,
  (e) => {
    "use strict";
    e.i(78700);
    var t = e.i(16323),
      i = e.i(43259),
      s = e.i(85692),
      n = e.i(96430),
      r = e.i(27581),
      a = e.i(64196),
      o = e.i(17428),
      l = e.i(17237),
      u = e.i(25113),
      h = e.i(31112),
      c = e.i(86240),
      p = e.i(96561),
      d = e.i(10873),
      m = e.i(40591);
    let f = (e) => {
      let t = ({ timestamp: t }) => e(t);
      return {
        start: () => m.frame.update(t, !0),
        stop: () => (0, m.cancelFrame)(t),
        now: () =>
          m.frameData.isProcessing ? m.frameData.timestamp : d.time.now(),
      };
    };
    var g = e.i(64605);
    let v = {
        decay: u.inertia,
        inertia: u.inertia,
        tween: h.keyframes,
        keyframes: h.keyframes,
        spring: c.spring,
      },
      y = (e) => e / 100;
    class b extends p.BaseAnimation {
      constructor(e) {
        (super(e),
          (this.holdTime = null),
          (this.cancelTime = null),
          (this.currentTime = 0),
          (this.playbackSpeed = 1),
          (this.pendingPlayState = "running"),
          (this.startTime = null),
          (this.state = "idle"),
          (this.stop = () => {
            if (
              (this.resolver.cancel(),
              (this.isStopped = !0),
              "idle" === this.state)
            )
              return;
            this.teardown();
            let { onStop: e } = this.options;
            e && e();
          }));
        const {
            name: t,
            motionValue: i,
            element: s,
            keyframes: r,
          } = this.options,
          a = (null == s ? void 0 : s.KeyframeResolver) || n.KeyframeResolver,
          o = (e, t) => this.onKeyframesResolved(e, t);
        ((this.resolver = new a(r, o, t, i, s)),
          this.resolver.scheduleResolve());
      }
      flatten() {
        (super.flatten(),
          this._resolved &&
            Object.assign(
              this._resolved,
              this.initPlayback(this._resolved.keyframes),
            ));
      }
      initPlayback(e) {
        let t,
          n,
          {
            type: r = "keyframes",
            repeat: a = 0,
            repeatDelay: u = 0,
            repeatType: c,
            velocity: p = 0,
          } = this.options,
          d = (0, s.isGenerator)(r) ? r : v[r] || h.keyframes;
        d !== h.keyframes &&
          "number" != typeof e[0] &&
          ((t = (0, l.pipe)(y, (0, o.mix)(e[0], e[1]))), (e = [0, 100]));
        let m = d({ ...this.options, keyframes: e });
        ("mirror" === c &&
          (n = d({
            ...this.options,
            keyframes: [...e].reverse(),
            velocity: -p,
          })),
          null === m.calculatedDuration &&
            (m.calculatedDuration = (0, i.calcGeneratorDuration)(m)));
        let { calculatedDuration: f } = m,
          g = f + u;
        return {
          generator: m,
          mirroredGenerator: n,
          mapPercentToKeyframes: t,
          calculatedDuration: f,
          resolvedDuration: g,
          totalDuration: g * (a + 1) - u,
        };
      }
      onPostResolved() {
        let { autoplay: e = !0 } = this.options;
        (r.activeAnimations.mainThread++,
          this.play(),
          "paused" !== this.pendingPlayState && e
            ? (this.state = this.pendingPlayState)
            : this.pause());
      }
      tick(e, t = !1) {
        let { resolved: i } = this;
        if (!i) {
          let { keyframes: e } = this.options;
          return { done: !0, value: e[e.length - 1] };
        }
        let {
          finalKeyframe: s,
          generator: n,
          mirroredGenerator: r,
          mapPercentToKeyframes: o,
          keyframes: l,
          calculatedDuration: u,
          totalDuration: h,
          resolvedDuration: c,
        } = i;
        if (null === this.startTime) return n.next(0);
        let {
          delay: p,
          repeat: d,
          repeatType: m,
          repeatDelay: f,
          onUpdate: v,
        } = this.options;
        (this.speed > 0
          ? (this.startTime = Math.min(this.startTime, e))
          : this.speed < 0 &&
            (this.startTime = Math.min(e - h / this.speed, this.startTime)),
          t
            ? (this.currentTime = e)
            : null !== this.holdTime
              ? (this.currentTime = this.holdTime)
              : (this.currentTime =
                  Math.round(e - this.startTime) * this.speed));
        let y = this.currentTime - p * (this.speed >= 0 ? 1 : -1),
          b = this.speed >= 0 ? y < 0 : y > h;
        ((this.currentTime = Math.max(y, 0)),
          "finished" === this.state &&
            null === this.holdTime &&
            (this.currentTime = h));
        let S = this.currentTime,
          T = n;
        if (d) {
          let e = Math.min(this.currentTime, h) / c,
            t = Math.floor(e),
            i = e % 1;
          (!i && e >= 1 && (i = 1),
            1 === i && t--,
            (t = Math.min(t, d + 1)) % 2 &&
              ("reverse" === m
                ? ((i = 1 - i), f && (i -= f / c))
                : "mirror" === m && (T = r)),
            (S = (0, a.clamp)(0, 1, i) * c));
        }
        let V = b ? { done: !1, value: l[0] } : T.next(S);
        o && (V.value = o(V.value));
        let { done: x } = V;
        b ||
          null === u ||
          (x = this.speed >= 0 ? this.currentTime >= h : this.currentTime <= 0);
        let w =
          null === this.holdTime &&
          ("finished" === this.state || ("running" === this.state && x));
        return (
          w &&
            void 0 !== s &&
            (V.value = (0, g.getFinalKeyframe)(l, this.options, s)),
          v && v(V.value),
          w && this.finish(),
          V
        );
      }
      get duration() {
        let { resolved: e } = this;
        return e ? (0, t.millisecondsToSeconds)(e.calculatedDuration) : 0;
      }
      get time() {
        return (0, t.millisecondsToSeconds)(this.currentTime);
      }
      set time(e) {
        ((e = (0, t.secondsToMilliseconds)(e)),
          (this.currentTime = e),
          null !== this.holdTime || 0 === this.speed
            ? (this.holdTime = e)
            : this.driver &&
              (this.startTime = this.driver.now() - e / this.speed));
      }
      get speed() {
        return this.playbackSpeed;
      }
      set speed(e) {
        let i = this.playbackSpeed !== e;
        ((this.playbackSpeed = e),
          i && (this.time = (0, t.millisecondsToSeconds)(this.currentTime)));
      }
      play() {
        if (
          (this.resolver.isScheduled || this.resolver.resume(), !this._resolved)
        ) {
          this.pendingPlayState = "running";
          return;
        }
        if (this.isStopped) return;
        let { driver: e = f, onPlay: t, startTime: i } = this.options;
        (this.driver || (this.driver = e((e) => this.tick(e))), t && t());
        let s = this.driver.now();
        (null !== this.holdTime
          ? (this.startTime = s - this.holdTime)
          : this.startTime
            ? "finished" === this.state && (this.startTime = s)
            : (this.startTime = null != i ? i : this.calcStartTime()),
          "finished" === this.state && this.updateFinishedPromise(),
          (this.cancelTime = this.startTime),
          (this.holdTime = null),
          (this.state = "running"),
          this.driver.start());
      }
      pause() {
        var e;
        if (!this._resolved) {
          this.pendingPlayState = "paused";
          return;
        }
        ((this.state = "paused"),
          (this.holdTime = null != (e = this.currentTime) ? e : 0));
      }
      complete() {
        ("running" !== this.state && this.play(),
          (this.pendingPlayState = this.state = "finished"),
          (this.holdTime = null));
      }
      finish() {
        (this.teardown(), (this.state = "finished"));
        let { onComplete: e } = this.options;
        e && e();
      }
      cancel() {
        (null !== this.cancelTime && this.tick(this.cancelTime),
          this.teardown(),
          this.updateFinishedPromise());
      }
      teardown() {
        ((this.state = "idle"),
          this.stopDriver(),
          this.resolveFinishedPromise(),
          this.updateFinishedPromise(),
          (this.startTime = this.cancelTime = null),
          this.resolver.cancel(),
          r.activeAnimations.mainThread--);
      }
      stopDriver() {
        this.driver && (this.driver.stop(), (this.driver = void 0));
      }
      sample(e) {
        return ((this.startTime = 0), this.tick(e, !0));
      }
    }
    e.s(
      [
        "MainThreadAnimation",
        0,
        b,
        "animateValue",
        0,
        function (e) {
          return new b(e);
        },
      ],
      42036,
    );
  },
  28378,
  22564,
  62287,
  59370,
  95904,
  (e) => {
    "use strict";
    var t = e.i(94819),
      i = e.i(41814),
      s = e.i(1170),
      n = e.i(17167),
      r = e.i(38069),
      a = e.i(15096),
      o = e.i(16323),
      l = e.i(40591),
      u = e.i(84318),
      h = e.i(20523),
      c = e.i(91069),
      p = e.i(85692),
      d = e.i(19649),
      m = e.i(36970),
      f = e.i(25111),
      g = e.i(78274),
      v = e.i(79769),
      y = e.i(5299),
      b = e.i(36276),
      S = e.i(96561),
      T = e.i(42036);
    let V = new Set(["opacity", "clipPath", "filter", "transform"]);
    var x = e.i(27581),
      w = e.i(44795),
      M = e.i(64605);
    let A = (0, e.i(28375).memo)(() =>
        Object.hasOwnProperty.call(Element.prototype, "animate"),
      ),
      P = {
        anticipate: g.anticipate,
        backInOut: v.backInOut,
        circInOut: y.circInOut,
      };
    class D extends S.BaseAnimation {
      constructor(e) {
        super(e);
        const {
          name: t,
          motionValue: i,
          element: s,
          keyframes: n,
        } = this.options;
        ((this.resolver = new b.DOMKeyframesResolver(
          n,
          (e, t) => this.onKeyframesResolved(e, t),
          t,
          i,
          s,
        )),
          this.resolver.scheduleResolve());
      }
      initPlayback(e, t) {
        var i;
        let {
          duration: s = 300,
          times: n,
          ease: r,
          type: a,
          motionValue: o,
          name: l,
          startTime: u,
        } = this.options;
        if (!o.owner || !o.owner.current) return !1;
        if (
          ("string" == typeof r &&
            (0, f.supportsLinearEasing)() &&
            r in P &&
            (r = P[r]),
          (i = this.options),
          (0, p.isGenerator)(i.type) ||
            "spring" === i.type ||
            !(0, m.isWaapiSupportedEasing)(i.ease))
        ) {
          let {
              onComplete: t,
              onUpdate: i,
              motionValue: o,
              element: l,
              ...u
            } = this.options,
            h = (function (e, t) {
              let i = new T.MainThreadAnimation({
                  ...t,
                  keyframes: e,
                  repeat: 0,
                  delay: 0,
                  isGenerator: !0,
                }),
                s = { done: !1, value: e[0] },
                n = [],
                r = 0;
              for (; !s.done && r < 2e4;)
                (n.push((s = i.sample(r)).value), (r += 10));
              return {
                times: void 0,
                keyframes: n,
                duration: r - 10,
                ease: "linear",
              };
            })(e, u);
          (1 === (e = h.keyframes).length && (e[1] = e[0]),
            (s = h.duration),
            (n = h.times),
            (r = h.ease),
            (a = "keyframes"));
        }
        let h = (function (
          e,
          t,
          i,
          {
            delay: s = 0,
            duration: n = 300,
            repeat: r = 0,
            repeatType: a = "loop",
            ease: o = "easeInOut",
            times: l,
          } = {},
        ) {
          let u = { [t]: i };
          l && (u.offset = l);
          let h = (0, m.mapEasingToNativeEasing)(o, n);
          (Array.isArray(h) && (u.easing = h),
            w.statsBuffer.value && x.activeAnimations.waapi++);
          let c = e.animate(u, {
            delay: s,
            duration: n,
            easing: Array.isArray(h) ? "linear" : h,
            fill: "both",
            iterations: r + 1,
            direction: "reverse" === a ? "alternate" : "normal",
          });
          return (
            w.statsBuffer.value &&
              c.finished.finally(() => {
                x.activeAnimations.waapi--;
              }),
            c
          );
        })(o.owner.current, l, e, {
          ...this.options,
          duration: s,
          times: n,
          ease: r,
        });
        return (
          (h.startTime = null != u ? u : this.calcStartTime()),
          this.pendingTimeline
            ? ((0, d.attachTimeline)(h, this.pendingTimeline),
              (this.pendingTimeline = void 0))
            : (h.onfinish = () => {
                let { onComplete: i } = this.options;
                (o.set((0, M.getFinalKeyframe)(e, this.options, t)),
                  i && i(),
                  this.cancel(),
                  this.resolveFinishedPromise());
              }),
          {
            animation: h,
            duration: s,
            times: n,
            type: a,
            ease: r,
            keyframes: e,
          }
        );
      }
      get duration() {
        let { resolved: e } = this;
        if (!e) return 0;
        let { duration: t } = e;
        return (0, o.millisecondsToSeconds)(t);
      }
      get time() {
        let { resolved: e } = this;
        if (!e) return 0;
        let { animation: t } = e;
        return (0, o.millisecondsToSeconds)(t.currentTime || 0);
      }
      set time(e) {
        let { resolved: t } = this;
        if (!t) return;
        let { animation: i } = t;
        i.currentTime = (0, o.secondsToMilliseconds)(e);
      }
      get speed() {
        let { resolved: e } = this;
        if (!e) return 1;
        let { animation: t } = e;
        return t.playbackRate;
      }
      set speed(e) {
        let { resolved: t } = this;
        if (!t) return;
        let { animation: i } = t;
        i.playbackRate = e;
      }
      get state() {
        let { resolved: e } = this;
        if (!e) return "idle";
        let { animation: t } = e;
        return t.playState;
      }
      get startTime() {
        let { resolved: e } = this;
        if (!e) return null;
        let { animation: t } = e;
        return t.startTime;
      }
      attachTimeline(e) {
        if (this._resolved) {
          let { resolved: t } = this;
          if (!t) return c.noop;
          let { animation: i } = t;
          (0, d.attachTimeline)(i, e);
        } else this.pendingTimeline = e;
        return c.noop;
      }
      play() {
        if (this.isStopped) return;
        let { resolved: e } = this;
        if (!e) return;
        let { animation: t } = e;
        ("finished" === t.playState && this.updateFinishedPromise(), t.play());
      }
      pause() {
        let { resolved: e } = this;
        if (!e) return;
        let { animation: t } = e;
        t.pause();
      }
      stop() {
        if (
          (this.resolver.cancel(), (this.isStopped = !0), "idle" === this.state)
        )
          return;
        (this.resolveFinishedPromise(), this.updateFinishedPromise());
        let { resolved: e } = this;
        if (!e) return;
        let {
          animation: t,
          keyframes: i,
          duration: s,
          type: n,
          ease: r,
          times: a,
        } = e;
        if ("idle" === t.playState || "finished" === t.playState) return;
        if (this.time) {
          let {
              motionValue: e,
              onUpdate: t,
              onComplete: l,
              element: u,
              ...h
            } = this.options,
            c = new T.MainThreadAnimation({
              ...h,
              keyframes: i,
              duration: s,
              type: n,
              ease: r,
              times: a,
              isGenerator: !0,
            }),
            p = (0, o.secondsToMilliseconds)(this.time);
          e.setWithVelocity(c.sample(p - 10).value, c.sample(p).value, 10);
        }
        let { onStop: l } = this.options;
        (l && l(), this.cancel());
      }
      complete() {
        let { resolved: e } = this;
        e && e.animation.finish();
      }
      cancel() {
        let { resolved: e } = this;
        e && e.animation.cancel();
      }
      static supports(e) {
        let {
          motionValue: t,
          name: i,
          repeatDelay: s,
          repeatType: n,
          damping: r,
          type: a,
        } = e;
        if (!t || !t.owner || !(t.owner.current instanceof HTMLElement))
          return !1;
        let { onUpdate: o, transformTemplate: l } = t.owner.getProps();
        return (
          A() &&
          i &&
          V.has(i) &&
          !o &&
          !l &&
          !s &&
          "mirror" !== n &&
          0 !== r &&
          "inertia" !== a
        );
      }
    }
    var I = e.i(31535);
    let C = { type: "spring", stiffness: 500, damping: 25, restSpeed: 10 },
      O = { type: "keyframes", duration: 0.8 },
      k = { type: "keyframes", ease: [0.25, 0.1, 0.35, 1], duration: 0.3 },
      F =
        (e, i, s, n = {}, r, c) =>
        (p) => {
          let d = (0, t.getValueTransition)(n, e) || {},
            m = d.delay || n.delay || 0,
            { elapsed: f = 0 } = n;
          f -= (0, o.secondsToMilliseconds)(m);
          let g = {
            keyframes: Array.isArray(s) ? s : [null, s],
            ease: "easeOut",
            velocity: i.getVelocity(),
            ...d,
            delay: -f,
            onUpdate: (e) => {
              (i.set(e), d.onUpdate && d.onUpdate(e));
            },
            onComplete: () => {
              (p(), d.onComplete && d.onComplete());
            },
            name: e,
            motionValue: i,
            element: c ? void 0 : r,
          };
          (!(function ({
            when: e,
            delay: t,
            delayChildren: i,
            staggerChildren: s,
            staggerDirection: n,
            repeat: r,
            repeatType: a,
            repeatDelay: o,
            from: l,
            elapsed: u,
            ...h
          }) {
            return !!Object.keys(h).length;
          })(d) &&
            (g = {
              ...g,
              ...((e, { keyframes: t }) =>
                t.length > 2
                  ? O
                  : I.transformProps.has(e)
                    ? e.startsWith("scale")
                      ? {
                          type: "spring",
                          stiffness: 550,
                          damping: 0 === t[1] ? 2 * Math.sqrt(550) : 30,
                          restSpeed: 10,
                        }
                      : C
                    : k)(e, g),
            }),
            g.duration &&
              (g.duration = (0, o.secondsToMilliseconds)(g.duration)),
            g.repeatDelay &&
              (g.repeatDelay = (0, o.secondsToMilliseconds)(g.repeatDelay)),
            void 0 !== g.from && (g.keyframes[0] = g.from));
          let v = !1;
          if (
            ((!1 !== g.type && (0 !== g.duration || g.repeatDelay)) ||
              ((g.duration = 0), 0 === g.delay && (v = !0)),
            (h.instantAnimationState.current ||
              u.MotionGlobalConfig.skipAnimations) &&
              ((v = !0), (g.duration = 0), (g.delay = 0)),
            v && !c && void 0 !== i.get())
          ) {
            let e = (0, M.getFinalKeyframe)(g.keyframes, d);
            if (void 0 !== e)
              return (
                l.frame.update(() => {
                  (g.onUpdate(e), g.onComplete());
                }),
                new a.GroupPlaybackControls([])
              );
          }
          return !c && D.supports(g) ? new D(g) : new T.MainThreadAnimation(g);
        };
    (e.s(["animateMotionValue", 0, F], 22564),
      e.s(
        [
          "animateTarget",
          0,
          function (
            e,
            a,
            { delay: o = 0, transitionOverride: u, type: h } = {},
          ) {
            var c;
            let {
              transition: p = e.getDefaultTransition(),
              transitionEnd: d,
              ...m
            } = a;
            u && (p = u);
            let f = [],
              g = h && e.animationState && e.animationState.getState()[h];
            for (let s in m) {
              let a = e.getValue(s, null != (c = e.latestValues[s]) ? c : null),
                u = m[s];
              if (
                void 0 === u ||
                (g &&
                  (function ({ protectedKeys: e, needsAnimating: t }, i) {
                    let s = e.hasOwnProperty(i) && !0 !== t[i];
                    return ((t[i] = !1), s);
                  })(g, s))
              )
                continue;
              let h = { delay: o, ...(0, t.getValueTransition)(p || {}, s) },
                d = !1;
              if (window.MotionHandoffAnimation) {
                let t = (0, r.getOptimisedAppearId)(e);
                if (t) {
                  let e = window.MotionHandoffAnimation(t, s, l.frame);
                  null !== e && ((h.startTime = e), (d = !0));
                }
              }
              ((0, n.addValueToWillChange)(e, s),
                a.start(
                  F(
                    s,
                    a,
                    u,
                    e.shouldReduceMotion && i.positionalKeys.has(s)
                      ? { type: !1 }
                      : h,
                    e,
                    d,
                  ),
                ));
              let v = a.animation;
              v && f.push(v);
            }
            return (
              d &&
                Promise.all(f).then(() => {
                  l.frame.update(() => {
                    d && (0, s.setTarget)(e, d);
                  });
                }),
              f
            );
          },
        ],
        28378,
      ),
      e.s(
        [
          "isSVGElement",
          0,
          function (e) {
            return e instanceof SVGElement && "svg" !== e.tagName;
          },
        ],
        62287,
      ));
    let E = () => ({ min: 0, max: 0 });
    e.s(["createBox", 0, () => ({ x: E(), y: E() })], 59370);
    let R = {
        animation: [
          "animate",
          "variants",
          "whileHover",
          "whileTap",
          "exit",
          "whileInView",
          "whileFocus",
          "whileDrag",
        ],
        exit: ["exit"],
        drag: ["drag", "dragControls"],
        focus: ["whileFocus"],
        hover: ["whileHover", "onHoverStart", "onHoverEnd"],
        tap: ["whileTap", "onTap", "onTapStart", "onTapCancel"],
        pan: ["onPan", "onPanStart", "onPanSessionStart", "onPanEnd"],
        inView: ["whileInView", "onViewportEnter", "onViewportLeave"],
        layout: ["layout", "layoutId"],
      },
      B = {};
    for (let e in R) B[e] = { isEnabled: (t) => R[e].some((e) => !!t[e]) };
    e.s(["featureDefinitions", 0, B], 95904);
  },
  21813,
  (e) => {
    "use strict";
    let t = "u" > typeof window;
    e.s(["isBrowser", 0, t]);
  },
  50987,
  53985,
  (e) => {
    "use strict";
    var t = e.i(15096),
      i = e.i(86240),
      s = e.i(27451),
      n = e.i(4761),
      r = e.i(10658),
      a = e.i(66011),
      o = e.i(28378),
      l = e.i(62287),
      u = e.i(40591),
      h = e.i(59370);
    e.i(78700);
    var c = e.i(10873),
      p = e.i(95904),
      d = e.i(74199),
      m = e.i(46581),
      f = e.i(21813);
    let g = { current: null },
      v = { current: !1 };
    var y = e.i(75546),
      b = e.i(59814),
      S = e.i(55612),
      T = e.i(7537),
      V = e.i(42406),
      x = e.i(43489),
      w = e.i(42504);
    let M = [...x.dimensionValueTypes, V.color, S.complex];
    var A = e.i(31535);
    let P = [
      "initial",
      "animate",
      "whileInView",
      "whileFocus",
      "whileHover",
      "whileTap",
      "whileDrag",
      "exit",
    ];
    function D(e) {
      var t;
      return (
        (null !== (t = e.animate) &&
          "object" == typeof t &&
          "function" == typeof t.start) ||
        P.some((t) => {
          var i;
          return "string" == typeof (i = e[t]) || Array.isArray(i);
        })
      );
    }
    var I = e.i(96430),
      C = e.i(32583);
    let O = [
      "AnimationStart",
      "AnimationComplete",
      "Update",
      "BeforeLayoutMeasure",
      "LayoutMeasure",
      "LayoutAnimationStart",
      "LayoutAnimationComplete",
    ];
    class k {
      scrapeMotionValuesFromProps(e, t, i) {
        return {};
      }
      constructor(
        {
          parent: e,
          props: t,
          presenceContext: i,
          reducedMotionConfig: s,
          blockInitialAnimation: n,
          visualState: r,
        },
        o = {},
      ) {
        ((this.current = null),
          (this.children = new Set()),
          (this.isVariantNode = !1),
          (this.isControllingVariants = !1),
          (this.shouldReduceMotion = null),
          (this.values = new Map()),
          (this.KeyframeResolver = I.KeyframeResolver),
          (this.features = {}),
          (this.valueSubscriptions = new Map()),
          (this.prevMotionValues = {}),
          (this.events = {}),
          (this.propEventSubscriptions = {}),
          (this.notifyUpdate = () => this.notify("Update", this.latestValues)),
          (this.render = () => {
            this.current &&
              (this.triggerBuild(),
              this.renderInstance(
                this.current,
                this.renderState,
                this.props.style,
                this.projection,
              ));
          }),
          (this.renderScheduledAt = 0),
          (this.scheduleRender = () => {
            let e = c.time.now();
            this.renderScheduledAt < e &&
              ((this.renderScheduledAt = e),
              u.frame.render(this.render, !1, !0));
          }));
        const { latestValues: l, renderState: h, onUpdate: p } = r;
        ((this.onUpdate = p),
          (this.latestValues = l),
          (this.baseTarget = { ...l }),
          (this.initialValues = t.initial ? { ...l } : {}),
          (this.renderState = h),
          (this.parent = e),
          (this.props = t),
          (this.presenceContext = i),
          (this.depth = e ? e.depth + 1 : 0),
          (this.reducedMotionConfig = s),
          (this.options = o),
          (this.blockInitialAnimation = !!n),
          (this.isControllingVariants = D(t)),
          (this.isVariantNode = (function (e) {
            return !!(D(e) || e.variants);
          })(t)),
          this.isVariantNode && (this.variantChildren = new Set()),
          (this.manuallyAnimateOnMount = !!(e && e.current)));
        const { willChange: d, ...m } = this.scrapeMotionValuesFromProps(
          t,
          {},
          this,
        );
        for (const e in m) {
          const t = m[e];
          void 0 !== l[e] && (0, a.isMotionValue)(t) && t.set(l[e], !1);
        }
      }
      mount(e) {
        ((this.current = e),
          r.visualElementStore.set(e, this),
          this.projection &&
            !this.projection.instance &&
            this.projection.mount(e),
          this.parent &&
            this.isVariantNode &&
            !this.isControllingVariants &&
            (this.removeFromVariantTree = this.parent.addVariantChild(this)),
          this.values.forEach((e, t) => this.bindToMotionValue(t, e)),
          v.current ||
            (function () {
              if (((v.current = !0), f.isBrowser))
                if (window.matchMedia) {
                  let e = window.matchMedia("(prefers-reduced-motion)"),
                    t = () => (g.current = e.matches);
                  (e.addListener(t), t());
                } else g.current = !1;
            })(),
          (this.shouldReduceMotion =
            "never" !== this.reducedMotionConfig &&
            ("always" === this.reducedMotionConfig || g.current)),
          this.parent && this.parent.children.add(this),
          this.update(this.props, this.presenceContext));
      }
      unmount() {
        for (let e in (this.projection && this.projection.unmount(),
        (0, u.cancelFrame)(this.notifyUpdate),
        (0, u.cancelFrame)(this.render),
        this.valueSubscriptions.forEach((e) => e()),
        this.valueSubscriptions.clear(),
        this.removeFromVariantTree && this.removeFromVariantTree(),
        this.parent && this.parent.children.delete(this),
        this.events))
          this.events[e].clear();
        for (let e in this.features) {
          let t = this.features[e];
          t && (t.unmount(), (t.isMounted = !1));
        }
        this.current = null;
      }
      bindToMotionValue(e, t) {
        let i;
        this.valueSubscriptions.has(e) && this.valueSubscriptions.get(e)();
        let s = A.transformProps.has(e);
        s && this.onBindTransform && this.onBindTransform();
        let n = t.on("change", (t) => {
            ((this.latestValues[e] = t),
              this.props.onUpdate && u.frame.preRender(this.notifyUpdate),
              s && this.projection && (this.projection.isTransformDirty = !0));
          }),
          r = t.on("renderRequest", this.scheduleRender);
        (window.MotionCheckAppearSync &&
          (i = window.MotionCheckAppearSync(this, e, t)),
          this.valueSubscriptions.set(e, () => {
            (n(), r(), i && i(), t.owner && t.stop());
          }));
      }
      sortNodePosition(e) {
        return this.current &&
          this.sortInstanceNodePosition &&
          this.type === e.type
          ? this.sortInstanceNodePosition(this.current, e.current)
          : 0;
      }
      updateFeatures() {
        let e = "animation";
        for (e in p.featureDefinitions) {
          let t = p.featureDefinitions[e];
          if (!t) continue;
          let { isEnabled: i, Feature: s } = t;
          if (
            (!this.features[e] &&
              s &&
              i(this.props) &&
              (this.features[e] = new s(this)),
            this.features[e])
          ) {
            let t = this.features[e];
            t.isMounted ? t.update() : (t.mount(), (t.isMounted = !0));
          }
        }
      }
      triggerBuild() {
        this.build(this.renderState, this.latestValues, this.props);
      }
      measureViewportBox() {
        return this.current
          ? this.measureInstanceViewportBox(this.current, this.props)
          : (0, h.createBox)();
      }
      getStaticValue(e) {
        return this.latestValues[e];
      }
      setStaticValue(e, t) {
        this.latestValues[e] = t;
      }
      update(e, t) {
        ((e.transformTemplate || this.props.transformTemplate) &&
          this.scheduleRender(),
          (this.prevProps = this.props),
          (this.props = e),
          (this.prevPresenceContext = this.presenceContext),
          (this.presenceContext = t));
        for (let t = 0; t < O.length; t++) {
          let i = O[t];
          this.propEventSubscriptions[i] &&
            (this.propEventSubscriptions[i](),
            delete this.propEventSubscriptions[i]);
          let s = e["on" + i];
          s && (this.propEventSubscriptions[i] = this.on(i, s));
        }
        ((this.prevMotionValues = (function (e, t, i) {
          for (let s in t) {
            let n = t[s],
              r = i[s];
            if ((0, a.isMotionValue)(n)) e.addValue(s, n);
            else if ((0, a.isMotionValue)(r))
              e.addValue(s, (0, b.motionValue)(n, { owner: e }));
            else if (r !== n)
              if (e.hasValue(s)) {
                let t = e.getValue(s);
                !0 === t.liveStyle ? t.jump(n) : t.hasAnimated || t.set(n);
              } else {
                let t = e.getStaticValue(s);
                e.addValue(
                  s,
                  (0, b.motionValue)(void 0 !== t ? t : n, { owner: e }),
                );
              }
          }
          for (let s in i) void 0 === t[s] && e.removeValue(s);
          return t;
        })(
          this,
          this.scrapeMotionValuesFromProps(e, this.prevProps, this),
          this.prevMotionValues,
        )),
          this.handleChildMotionValue && this.handleChildMotionValue(),
          this.onUpdate && this.onUpdate(this));
      }
      getProps() {
        return this.props;
      }
      getVariant(e) {
        return this.props.variants ? this.props.variants[e] : void 0;
      }
      getDefaultTransition() {
        return this.props.transition;
      }
      getTransformPagePoint() {
        return this.props.transformPagePoint;
      }
      getClosestVariantNode() {
        return this.isVariantNode
          ? this
          : this.parent
            ? this.parent.getClosestVariantNode()
            : void 0;
      }
      addVariantChild(e) {
        let t = this.getClosestVariantNode();
        if (t)
          return (
            t.variantChildren && t.variantChildren.add(e),
            () => t.variantChildren.delete(e)
          );
      }
      addValue(e, t) {
        let i = this.values.get(e);
        t !== i &&
          (i && this.removeValue(e),
          this.bindToMotionValue(e, t),
          this.values.set(e, t),
          (this.latestValues[e] = t.get()));
      }
      removeValue(e) {
        this.values.delete(e);
        let t = this.valueSubscriptions.get(e);
        (t && (t(), this.valueSubscriptions.delete(e)),
          delete this.latestValues[e],
          this.removeValueFromRenderState(e, this.renderState));
      }
      hasValue(e) {
        return this.values.has(e);
      }
      getValue(e, t) {
        if (this.props.values && this.props.values[e])
          return this.props.values[e];
        let i = this.values.get(e);
        return (
          void 0 === i &&
            void 0 !== t &&
            ((i = (0, b.motionValue)(null === t ? void 0 : t, { owner: this })),
            this.addValue(e, i)),
          i
        );
      }
      readValue(e, t) {
        var i;
        let s =
          void 0 === this.latestValues[e] && this.current
            ? null != (i = this.getBaseTargetFromProps(this.props, e))
              ? i
              : this.readValueFromInstance(this.current, e, this.options)
            : this.latestValues[e];
        if (null != s) {
          if (
            "string" == typeof s &&
            ((0, d.isNumericalString)(s) || (0, m.isZeroValueString)(s))
          )
            s = parseFloat(s);
          else {
            let i;
            ((i = s),
              !M.find((0, w.testValueType)(i)) &&
                S.complex.test(t) &&
                (s = (0, T.getAnimatableNone)(e, t)));
          }
          this.setBaseTarget(e, (0, a.isMotionValue)(s) ? s.get() : s);
        }
        return (0, a.isMotionValue)(s) ? s.get() : s;
      }
      setBaseTarget(e, t) {
        this.baseTarget[e] = t;
      }
      getBaseTarget(e) {
        var t;
        let i,
          { initial: s } = this.props;
        if ("string" == typeof s || "object" == typeof s) {
          let n = (0, C.resolveVariantFromProps)(
            this.props,
            s,
            null == (t = this.presenceContext) ? void 0 : t.custom,
          );
          n && (i = n[e]);
        }
        if (s && void 0 !== i) return i;
        let n = this.getBaseTargetFromProps(this.props, e);
        return void 0 === n || (0, a.isMotionValue)(n)
          ? void 0 !== this.initialValues[e] && void 0 === i
            ? void 0
            : this.baseTarget[e]
          : n;
      }
      on(e, t) {
        return (
          this.events[e] || (this.events[e] = new y.SubscriptionManager()),
          this.events[e].add(t)
        );
      }
      notify(e, ...t) {
        this.events[e] && this.events[e].notify(...t);
      }
    }
    var F = e.i(36276);
    class E extends k {
      constructor() {
        (super(...arguments), (this.KeyframeResolver = F.DOMKeyframesResolver));
      }
      sortInstanceNodePosition(e, t) {
        return 2 & e.compareDocumentPosition(t) ? 1 : -1;
      }
      getBaseTargetFromProps(e, t) {
        return e.style ? e.style[t] : void 0;
      }
      removeValueFromRenderState(e, { vars: t, style: i }) {
        (delete t[e], delete i[e]);
      }
      handleChildMotionValue() {
        this.childSubscription &&
          (this.childSubscription(), delete this.childSubscription);
        let { children: e } = this.props;
        (0, a.isMotionValue)(e) &&
          (this.childSubscription = e.on("change", (e) => {
            this.current && (this.current.textContent = `${e}`);
          }));
      }
    }
    var R = e.i(15495),
      B = e.i(85116),
      N = e.i(88622);
    let K = (e, t) => (t && "number" == typeof e ? t.transform(e) : e);
    var L = e.i(10097);
    let j = {
        x: "translateX",
        y: "translateY",
        z: "translateZ",
        transformPerspective: "perspective",
      },
      $ = A.transformPropOrder.length;
    function G(e, t, i) {
      let { style: s, vars: n, transformOrigin: r } = e,
        a = !1,
        o = !1;
      for (let e in t) {
        let i = t[e];
        if (A.transformProps.has(e)) {
          a = !0;
          continue;
        }
        if ((0, N.isCSSVariableName)(e)) {
          n[e] = i;
          continue;
        }
        {
          let t = K(i, L.numberValueTypes[e]);
          e.startsWith("origin") ? ((o = !0), (r[e] = t)) : (s[e] = t);
        }
      }
      if (
        (!t.transform &&
          (a || i
            ? (s.transform = (function (e, t, i) {
                let s = "",
                  n = !0;
                for (let r = 0; r < $; r++) {
                  let a = A.transformPropOrder[r],
                    o = e[a];
                  if (void 0 === o) continue;
                  let l = !0;
                  if (
                    !(l =
                      "number" == typeof o
                        ? o === +!!a.startsWith("scale")
                        : 0 === parseFloat(o)) ||
                    i
                  ) {
                    let e = K(o, L.numberValueTypes[a]);
                    if (!l) {
                      n = !1;
                      let t = j[a] || a;
                      s += `${t}(${e}) `;
                    }
                    i && (t[a] = e);
                  }
                }
                return (
                  (s = s.trim()),
                  i ? (s = i(t, n ? "" : s)) : n && (s = "none"),
                  s
                );
              })(t, e.transform, i))
            : s.transform && (s.transform = "none")),
        o)
      ) {
        let { originX: e = "50%", originY: t = "50%", originZ: i = 0 } = r;
        s.transformOrigin = `${e} ${t} ${i}`;
      }
    }
    var W = e.i(17046);
    let z = { offset: "stroke-dashoffset", array: "stroke-dasharray" },
      U = { offset: "strokeDashoffset", array: "strokeDasharray" };
    function q(e, t, i) {
      return "string" == typeof e ? e : W.px.transform(t + i * e);
    }
    let _ = new Set([
      "baseFrequency",
      "diffuseConstant",
      "kernelMatrix",
      "kernelUnitLength",
      "keySplines",
      "keyTimes",
      "limitingConeAngle",
      "markerHeight",
      "markerWidth",
      "numOctaves",
      "targetX",
      "targetY",
      "surfaceScale",
      "specularConstant",
      "specularExponent",
      "stdDeviation",
      "tableValues",
      "viewBox",
      "gradientTransform",
      "pathLength",
      "startOffset",
      "textLength",
      "lengthAdjust",
    ]);
    function Y(e, { style: t, vars: i }, s, n) {
      for (let r in (Object.assign(e.style, t, n && n.getProjectionStyles(s)),
      i))
        e.style.setProperty(r, i[r]);
    }
    let X = {};
    function H(e, t, i) {
      var s;
      let { style: n } = e,
        r = {};
      for (let o in n)
        ((0, a.isMotionValue)(n[o]) ||
          (t.style && (0, a.isMotionValue)(t.style[o])) ||
          (function (e, { layout: t, layoutId: i }) {
            return (
              A.transformProps.has(e) ||
              e.startsWith("origin") ||
              ((t || void 0 !== i) && (!!X[e] || "opacity" === e))
            );
          })(o, e) ||
          (null == (s = null == i ? void 0 : i.getValue(o))
            ? void 0
            : s.liveStyle) !== void 0) &&
          (r[o] = n[o]);
      return r;
    }
    class Z extends E {
      constructor() {
        (super(...arguments),
          (this.type = "svg"),
          (this.isSVGTag = !1),
          (this.measureInstanceViewportBox = h.createBox),
          (this.updateDimensions = () => {
            this.current &&
              !this.renderState.dimensions &&
              (function (e, t) {
                try {
                  t.dimensions =
                    "function" == typeof e.getBBox
                      ? e.getBBox()
                      : e.getBoundingClientRect();
                } catch (e) {
                  t.dimensions = { x: 0, y: 0, width: 0, height: 0 };
                }
              })(this.current, this.renderState);
          }));
      }
      getBaseTargetFromProps(e, t) {
        return e[t];
      }
      readValueFromInstance(e, t) {
        if (A.transformProps.has(t)) {
          let e = (0, B.getDefaultValueType)(t);
          return (e && e.default) || 0;
        }
        return ((t = _.has(t) ? t : (0, R.camelToDash)(t)), e.getAttribute(t));
      }
      scrapeMotionValuesFromProps(e, t, i) {
        let s = H(e, t, i);
        for (let i in e)
          ((0, a.isMotionValue)(e[i]) || (0, a.isMotionValue)(t[i])) &&
            (s[
              -1 !== A.transformPropOrder.indexOf(i)
                ? "attr" + i.charAt(0).toUpperCase() + i.substring(1)
                : i
            ] = e[i]);
        return s;
      }
      onBindTransform() {
        this.current &&
          !this.renderState.dimensions &&
          u.frame.postRender(this.updateDimensions);
      }
      build(e, t, i) {
        !(function (
          e,
          {
            attrX: t,
            attrY: i,
            attrScale: s,
            originX: n,
            originY: r,
            pathLength: a,
            pathSpacing: o = 1,
            pathOffset: l = 0,
            ...u
          },
          h,
          c,
        ) {
          let p, d;
          if ((G(e, u, c), h)) {
            e.style.viewBox && (e.attrs.viewBox = e.style.viewBox);
            return;
          }
          ((e.attrs = e.style), (e.style = {}));
          let { attrs: m, style: f, dimensions: g } = e;
          (m.transform &&
            (g && (f.transform = m.transform), delete m.transform),
            g &&
              (void 0 !== n || void 0 !== r || f.transform) &&
              ((p = q(void 0 !== n ? n : 0.5, g.x, g.width)),
              (d = q(void 0 !== r ? r : 0.5, g.y, g.height)),
              (f.transformOrigin = `${p} ${d}`)),
            void 0 !== t && (m.x = t),
            void 0 !== i && (m.y = i),
            void 0 !== s && (m.scale = s),
            void 0 !== a &&
              (function (e, t, i = 1, s = 0, n = !0) {
                e.pathLength = 1;
                let r = n ? z : U;
                e[r.offset] = W.px.transform(-s);
                let a = W.px.transform(t),
                  o = W.px.transform(i);
                e[r.array] = `${a} ${o}`;
              })(m, a, o, l, !1));
        })(e, t, this.isSVGTag, i.transformTemplate);
      }
      renderInstance(e, t, i, s) {
        for (let i in (Y(e, t, void 0, s), t.attrs))
          e.setAttribute(_.has(i) ? i : (0, R.camelToDash)(i), t.attrs[i]);
      }
      mount(e) {
        let t;
        ((this.isSVGTag =
          "string" == typeof (t = e.tagName) && "svg" === t.toLowerCase()),
          super.mount(e));
      }
    }
    e.i(4944);
    class J extends E {
      constructor() {
        (super(...arguments), (this.type = "html"), (this.renderInstance = Y));
      }
      readValueFromInstance(e, t) {
        if (A.transformProps.has(t)) {
          let e = (0, B.getDefaultValueType)(t);
          return (e && e.default) || 0;
        }
        {
          let i = window.getComputedStyle(e),
            s =
              ((0, N.isCSSVariableName)(t) ? i.getPropertyValue(t) : i[t]) || 0;
          return "string" == typeof s ? s.trim() : s;
        }
      }
      measureInstanceViewportBox(e, { transformPagePoint: t }) {
        return (function ({ top: e, left: t, right: i, bottom: s }) {
          return { x: { min: t, max: i }, y: { min: e, max: s } };
        })(
          (function (e, t) {
            if (!t) return e;
            let i = t({ x: e.left, y: e.top }),
              s = t({ x: e.right, y: e.bottom });
            return { top: i.y, left: i.x, bottom: s.y, right: s.x };
          })(e.getBoundingClientRect(), t),
        );
      }
      build(e, t, i) {
        G(e, t, i.transformTemplate);
      }
      scrapeMotionValuesFromProps(e, t, i) {
        return H(e, t, i);
      }
    }
    class Q extends k {
      constructor() {
        (super(...arguments), (this.type = "object"));
      }
      readValueFromInstance(e, t) {
        if (t in e) {
          let i = e[t];
          if ("string" == typeof i || "number" == typeof i) return i;
        }
      }
      getBaseTargetFromProps() {}
      removeValueFromRenderState(e, t) {
        delete t.output[e];
      }
      measureInstanceViewportBox() {
        return (0, h.createBox)();
      }
      build(e, t) {
        Object.assign(e.output, t);
      }
      renderInstance(e, { output: t }) {
        Object.assign(e, t);
      }
      sortInstanceNodePosition() {
        return 0;
      }
    }
    function ee(e) {
      let t = {
          presenceContext: null,
          props: {},
          visualState: {
            renderState: {
              transform: {},
              transformOrigin: {},
              style: {},
              vars: {},
              attrs: {},
            },
            latestValues: {},
          },
        },
        i = (0, l.isSVGElement)(e) ? new Z(t) : new J(t);
      (i.mount(e), r.visualElementStore.set(e, i));
    }
    function et(e) {
      let t = new Q({
        presenceContext: null,
        props: {},
        visualState: { renderState: { output: {} }, latestValues: {} },
      });
      (t.mount(e), r.visualElementStore.set(e, t));
    }
    var ei = e.i(72198),
      es = e.i(24048),
      en = e.i(22564);
    function er(e, t, i, s) {
      var l, u;
      let h = [];
      if (
        (0, a.isMotionValue)(e) ||
        "number" == typeof e ||
        ("string" == typeof e && !(0, ei.isDOMKeyframes)(t))
      ) {
        let s;
        h.push(
          ((l = ((0, ei.isDOMKeyframes)(t) && t.default) || t),
          (u = (i && i.default) || i),
          (s = (0, a.isMotionValue)(e) ? e : (0, b.motionValue)(e)).start(
            (0, en.animateMotionValue)("", s, l, u),
          ),
          s.animation),
        );
      } else {
        let a = (0, es.resolveSubjects)(e, t, s),
          l = a.length;
        (0, n.invariant)(!!l, "No valid elements provided.");
        for (let e = 0; e < l; e++) {
          let s = a[e],
            n = s instanceof Element ? ee : et;
          r.visualElementStore.has(s) || n(s);
          let u = r.visualElementStore.get(s),
            c = { ...i };
          ("delay" in c &&
            "function" == typeof c.delay &&
            (c.delay = c.delay(e, l)),
            h.push(...(0, o.animateTarget)(u, { ...t, transition: c }, {})));
        }
      }
      return h;
    }
    (e.s(
      [
        "animate",
        0,
        function (e, n, r) {
          let a = [];
          if (Array.isArray(e) && e.some(Array.isArray)) {
            let t;
            ((t = []),
              (0, s.createAnimationsFromSequence)(e, n, void 0, {
                spring: i.spring,
              }).forEach(({ keyframes: e, transition: i }, s) => {
                t.push(...er(s, e, i));
              }),
              (a = t));
          } else a = er(e, n, r, void 0);
          return new t.GroupPlaybackControls(a);
        },
      ],
      50987,
    ),
      e.s(
        ["lightTextColor", 0, "rgb(255, 240, 235)", "restDelta", 0, 1e-4],
        53985,
      ));
  },
  21525,
  (e) => {
    "use strict";
    var t = e.i(59814),
      i = e.i(58547);
    let s = (0, e.i(43245).create)((e) => ({
      bloomEnabled: !1,
      noiseEnabled: !0,
      dpr: [1, 1.5],
      isMobileDevice: (0, t.motionValue)(!1),
      noiseFactor: (0, t.motionValue)(1),
      cameraPosition: (0, t.motionValue)(new i.Vector3(0, 0, 0)),
      cameraRotation: (0, t.motionValue)(new i.Vector3(0, 0, 0)),
      lensDistortionFactor: (0, t.motionValue)(1),
      isWebGLBackend: !1,
      reducedMemoryMode: !1,
      powerPreference: "high-performance",
      bloomBoost: (0, t.motionValue)(0),
      setBloomEnabled: (t) => e({ bloomEnabled: t }),
      setNoiseEnabled: (t) => e({ noiseEnabled: t }),
      setPowerPreference: (t) => e({ powerPreference: t }),
      setIsWebGLBackend: (t) => e({ isWebGLBackend: t }),
      setReducedMemoryMode: (t) => e({ reducedMemoryMode: t }),
    }));
    e.s(["useSettingsStore", 0, s]);
  },
  90551,
  16973,
  (e) => {
    "use strict";
    var t = e.i(50987),
      i = e.i(59814),
      s = e.i(43245),
      n = e.i(53985);
    let r = [
        {
          id: "hero",
          uiMode: "light",
          effects: {
            noiseVelocity: 1,
            noiseIntensity: 1.12,
            sepiaIntensity: 0.22,
            bloomThreshold: 0.54,
            bloomIntensity: 2,
            bloomRadius: 0.78,
            bloomSmoothing: 0.24,
            contrast: 0.97,
            brightness: 1.2,
            saturation: 1,
            motionBlur: 0.3,
            lensDistortion: 0,
            lensDistortionBorders: 0,
            pow: 1.92,
            chromaticAbberationStrength: 1.04,
            vignetteRadius: 0.5,
            vignetteSmoothness: 0.3,
            vignetteIntensity: 0.1,
          },
          length: 1,
          renderOffset: { beforeStart: 2 },
          pageOffset: { end: -0.2 },
          uiPageOffset: { end: -0.1 },
          transition: "direct",
          transitionLength: 0,
        },
        {
          id: "projects",
          uiMode: "light",
          effects: {
            noiseVelocity: 1,
            noiseIntensity: 0.87,
            sepiaIntensity: 0.28,
            bloomThreshold: 0.62,
            bloomIntensity: 0.77,
            bloomRadius: 0.8,
            bloomSmoothing: 0.2,
            contrast: 0.98,
            brightness: 1.08,
            saturation: 0.92,
            motionBlur: 0.4,
            lensDistortion: 0.16,
            lensDistortionBorders: 1,
            pow: 1.36,
            chromaticAbberationStrength: 1,
            vignetteRadius: 0,
            vignetteSmoothness: 0.32,
            vignetteIntensity: 0,
          },
          length: 1,
          renderOffset: { beforeStart: 0.9 },
          pageOffset: { start: -0.1, end: -0.7 },
          uiPageOffset: { start: -0.3 },
          transition: "fade",
          transitionLength: 0.2,
          effectTransitionLength: 1,
        },
        {
          id: "office",
          effects: {
            noiseVelocity: 1,
            noiseIntensity: 1.48,
            sepiaIntensity: 0.81,
            bloomThreshold: 0.55,
            bloomIntensity: 1.36,
            bloomRadius: 0.75,
            bloomSmoothing: 0.2,
            contrast: 1,
            brightness: 1,
            saturation: 0.56,
            lensDistortion: 0.16,
            lensDistortionBorders: 1,
            motionBlur: 0.5,
            pow: 1.34,
            chromaticAbberationStrength: 2.5,
            vignetteRadius: 0.5,
            vignetteSmoothness: 0.83,
            vignetteIntensity: 0.45,
          },
          length: 1.8,
          transition: "fade",
          renderOffset: { beforeStart: 0.7 },
          uiMode: "light",
          uiPageOffset: { start: 0, end: -0.36 },
          transitionLength: 0.4,
          effectOffset: -0.5,
          effectTransitionLength: 0.4,
        },
        {
          id: "about-us",
          effects: {
            noiseVelocity: 0.05,
            noiseIntensity: 1,
            sepiaIntensity: 0.4,
            bloomThreshold: 0.3,
            bloomIntensity: 0.1,
            bloomRadius: 0.74,
            bloomSmoothing: 0.65,
            contrast: 1,
            brightness: 1,
            saturation: 1,
            lensDistortion: 0.16,
            lensDistortionBorders: 0,
            motionBlur: 0,
            pow: 1.25,
            chromaticAbberationStrength: 0.8,
            vignetteRadius: 0.79,
            vignetteSmoothness: 0.13,
            vignetteIntensity: 0,
          },
          length: 7.3367496785380295,
          renderOffset: { afterEnd: 0.2 },
          uiPageOffset: { start: -0.35, end: -2.55 },
          uiMode: "dark",
          transition: "overlay",
          transitionLength: 2,
        },
        {
          id: "golden-tie-reveal",
          uiMode: "light",
          effects: {
            noiseVelocity: 1,
            noiseIntensity: 0.75,
            sepiaIntensity: 0.17,
            bloomThreshold: 0.67,
            bloomIntensity: 1.3,
            bloomRadius: 0.78,
            bloomSmoothing: 0.2,
            contrast: 0.95,
            brightness: 1,
            saturation: 0.75,
            lensDistortion: 0.16,
            lensDistortionBorders: 0,
            motionBlur: 0.3,
            pow: 1.4,
            chromaticAbberationStrength: 1,
            vignetteRadius: 0,
            vignetteSmoothness: 0,
            vignetteIntensity: 0,
          },
          uiPageOffset: { start: -3 },
          length: 1.7,
          transition: "below",
          transitionLength: 4.1,
          effectOffset: -2,
          effectTransitionLength: 2,
        },
        {
          id: "golden-tie",
          uiMode: "light",
          effects: {
            noiseVelocity: 1,
            noiseIntensity: 1,
            sepiaIntensity: 0.45,
            bloomThreshold: 0.67,
            bloomIntensity: 2,
            bloomRadius: 0.86,
            bloomSmoothing: 0.29,
            contrast: 0.95,
            brightness: 1,
            saturation: 0.7,
            lensDistortion: 0.16,
            lensDistortionBorders: 0,
            motionBlur: 0.3,
            pow: 1.4,
            chromaticAbberationStrength: 1,
            vignetteRadius: 0,
            vignetteSmoothness: 0,
            vignetteIntensity: 0,
          },
          length: 6,
          renderOffset: { afterEnd: -0.01 },
          transition: "below",
          transitionLength: 1.75,
          effectOffset: -1,
          effectTransitionLength: 0.5,
        },
        {
          id: "contact",
          uiMode: "light",
          effects: {
            noiseVelocity: 3.5,
            noiseIntensity: 0.7,
            bloomThreshold: 0.56,
            sepiaIntensity: 0.5,
            bloomIntensity: 0.8,
            bloomRadius: 0.72,
            bloomSmoothing: 0.3,
            contrast: 0.92,
            brightness: 1,
            saturation: 0.85,
            lensDistortion: 0.16,
            lensDistortionBorders: 0,
            motionBlur: 0.05,
            pow: 1.14,
            chromaticAbberationStrength: 1.15,
            vignetteRadius: 0,
            vignetteSmoothness: 0,
            vignetteIntensity: 0,
          },
          renderOffset: { beforeStart: 1.25 },
          pageOffset: { start: -0.9 },
          length: 3.3238571052836656,
          transition: "fade",
          transitionLength: 0.3,
          effectOffset: -0.2,
          effectTransitionLength: 0.5,
        },
      ],
      a = {
        noiseVelocity: 1,
        noiseIntensity: 0.9,
        sepiaIntensity: 0.1,
        bloomThreshold: 0.92,
        bloomIntensity: 0,
        bloomRadius: 0.8,
        bloomSmoothing: 0.2,
        contrast: 1,
        brightness: 1,
        saturation: 1,
        motionBlur: 0.2,
        lensDistortion: 0.16,
        lensDistortionBorders: 0,
        pow: 1.4,
        chromaticAbberationStrength: 0.5,
        vignetteRadius: 0,
        vignetteSmoothness: 0,
        vignetteIntensity: 0,
      },
      o = {
        noiseVelocity: 3.5,
        noiseIntensity: 0.7,
        bloomThreshold: 0.45,
        sepiaIntensity: 0.38,
        bloomIntensity: 0.61,
        bloomRadius: 0.84,
        bloomSmoothing: 0.91,
        contrast: 0.93,
        brightness: 1.56,
        saturation: 0.75,
        lensDistortion: 0,
        lensDistortionBorders: 0,
        motionBlur: 0.3,
        pow: 1.1,
        chromaticAbberationStrength: 1.18,
        vignetteRadius: 0,
        vignetteSmoothness: 0,
        vignetteIntensity: 0,
      },
      l = {
        noiseVelocity: 0.05,
        noiseIntensity: 1,
        sepiaIntensity: 0.4,
        bloomThreshold: 0.3,
        bloomIntensity: 0.1,
        bloomRadius: 0.74,
        bloomSmoothing: 0.65,
        contrast: 1,
        brightness: 1,
        saturation: 1,
        lensDistortion: 0.16,
        lensDistortionBorders: 0,
        motionBlur: 0,
        pow: 1.25,
        chromaticAbberationStrength: 0.8,
        vignetteRadius: 0.79,
        vignetteSmoothness: 0.13,
        vignetteIntensity: 0,
      };
    e.s(
      [
        "accessibilityStatementPageEffectsConfig",
        0,
        l,
        "loadingPageEffectsConfig",
        0,
        {
          noiseVelocity: 1,
          noiseIntensity: 1.4,
          bloomThreshold: 0,
          sepiaIntensity: 0.55,
          bloomIntensity: 0.24,
          bloomRadius: 0.83,
          bloomSmoothing: 0.5,
          contrast: 1,
          brightness: 0.65,
          saturation: 0.6,
          lensDistortion: 0.25,
          lensDistortionBorders: 0,
          motionBlur: 0.3,
          pow: 1.05,
          chromaticAbberationStrength: 1.5,
          vignetteRadius: 0.52,
          vignetteSmoothness: 0.27,
          vignetteIntensity: 0.3,
        },
        "notFoundPageEffectsConfig",
        0,
        o,
        "pagesConfig",
        0,
        r,
        "projectPageEffectsConfig",
        0,
        a,
        "subPageEffectsMap",
        0,
        { project: a, "not-found": o, "accessibility-statement": l },
        "transitionTypeMap",
        0,
        { fade: 0, direct: 1, overlay: 2, below: 3 },
      ],
      16973,
    );
    var u = e.i(21525);
    function h(e) {
      let t = 0,
        i = [],
        s = new Map();
      return (
        e.forEach((e) => {
          let n = { start: t, end: t + e.length },
            r = {
              start:
                n.start -
                Math.max(e.renderOffset?.beforeStart ?? 0, e.transitionLength),
              end: n.end + (e.renderOffset?.afterEnd ?? 0),
            };
          t = n.end;
          let a = { ...e, range: n, renderRange: r };
          (i.push(a), s.set(e.id, a));
        }),
        { pages: i, pagesMap: s }
      );
    }
    let c = (0, s.create)(() => {
      let e = [...r],
        { pages: s, pagesMap: a } = h(e),
        o = e,
        l = a,
        c = (0, i.motionValue)(s),
        p = (0, i.motionValue)(null),
        d = (0, i.motionValue)(null),
        m = (0, i.motionValue)(0),
        f = (0, i.motionValue)(!1);
      m.on("animationComplete", () => {
        p.set(null);
      });
      let g = null,
        v = 0,
        y = (0, i.motionValue)(!1),
        b = (e) => {
          let i = null !== p.get() && p.get()?.type === e?.type;
          g = (0, t.animate)(m, +!!e, {
            ...{
              "not-found": { damping: 20, stiffness: 80, type: "spring" },
              "accessibility-statement": { type: "tween", duration: 1.3 },
              project: { damping: 20, stiffness: 85, type: "spring" },
            }[e?.type ?? p.get()?.type ?? "not-found"],
            restDelta: n.restDelta,
            delay: 0.1 * !i,
            onPlay: () => (i ? f.set(!0) : f.set(!1)),
            onComplete: () => {
              (f.set(!0),
                setTimeout(() => {
                  y.set(!1);
                }, 1e3));
            },
            onStop: () => {
              (i ? f.set(!0) : f.set(!1),
                setTimeout(() => {
                  y.set(!1);
                }, 1e3));
            },
          });
        },
        S = (0, i.motionValue)(null),
        T = (0, i.motionValue)(0),
        V = (0, i.motionValue)(!1);
      S.on("change", (e) => {
        e &&
          setTimeout(() => {
            "main" === e
              ? (0, t.animate)(T, 1, {
                  damping: 8,
                  stiffness: 30,
                  restDelta: n.restDelta,
                  type: "spring",
                  onComplete: () => V.set(!0),
                })
              : "not-found" === e
                ? (0, t.animate)(T, 1, {
                    damping: 10,
                    stiffness: 30,
                    restDelta: n.restDelta,
                    type: "spring",
                    onComplete: () => V.set(!0),
                  })
                : (0, t.animate)(T, 1, {
                    duration: 1.5,
                    onComplete: () => V.set(!0),
                  });
          }, 500);
      });
      let x = (0, i.motionValue)(0),
        w = (0, i.motionValue)(null),
        M = (0, i.motionValue)(0),
        A = (0, i.motionValue)(0);
      return {
        initialPage: S,
        initialTransition: T,
        initialTransitionDone: V,
        activePage: (0, i.motionValue)("hero"),
        activeUiPage: (0, i.motionValue)("hero"),
        sectionTransition: x,
        sectionTransitionState: w,
        isLoadingProject: y,
        sectionLensDistortion: M,
        sectionLensDistortionBorder: A,
        subPage: d,
        previousSubPage: p,
        subPageTransitionIsDone: f,
        subPageTransition: m,
        navigateToSubPage: (e) => {
          (p.set(d.get()),
            d.set(e),
            u.useSettingsStore.getState().bloomBoost.set(0),
            g && g.stop(),
            e && 0.1 > m.get() ? (v = 30) : ((v = 0), b(e)));
        },
        onSubPageFrameRendered: () => {
          v <= 0 || (0 == --v && b(d.get()));
        },
        pages: c,
        setPageLength: (e, t) => {
          let i = o,
            s = l.get(e);
          if (s?.length === t) return;
          let n = i.map((i) => (i.id === e ? { ...i, length: t } : i));
          if (n !== i) {
            let { pages: e, pagesMap: t } = h(n);
            ((o = n), (l = t), c.set(e));
          }
        },
        updatePage: (e, t) => {
          let i = o.map((i) => (i.id === e ? { ...i, ...t } : i)),
            { pages: s, pagesMap: n } = h(i);
          ((o = i), (l = n), c.set(s));
        },
        resetPages: () => {
          let e = [...r],
            { pages: t, pagesMap: i } = h(e);
          ((o = e), (l = i), c.set(t));
        },
        getPage: (e) => {
          let t = l.get(e);
          if (!t) throw Error("Page not found, should not happen");
          return t;
        },
        notFoundNavigateTo: (0, i.motionValue)(null),
      };
    });
    e.s(["usePagesStore", 0, c], 90551);
  },
]);
