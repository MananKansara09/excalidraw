var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../scripts/woff2/woff2-vite-plugins.js
var require_woff2_vite_plugins = __commonJS({
  "../scripts/woff2/woff2-vite-plugins.js"(exports, module) {
    "use strict";
    var OSS_FONTS_CDN = "https://excalidraw.nyc3.cdn.digitaloceanspaces.com/oss/";
    var OSS_FONTS_FALLBACK = "/";
    module.exports.woff2BrowserPlugin = () => {
      let isDev;
      return {
        name: "woff2BrowserPlugin",
        enforce: "pre",
        config(_, { command }) {
          isDev = command === "serve";
        },
        transform(code, id) {
          if (!isDev && id.endsWith("/excalidraw/fonts/fonts.css")) {
            return `/* WARN: The following content is generated during excalidraw-app build */

      @font-face {
        font-family: "Assistant";
        src: url(${OSS_FONTS_CDN}fonts/Assistant/Assistant-Regular.woff2)
            format("woff2"),
          url(./Assistant-Regular.woff2) format("woff2");
        font-weight: 400;
        style: normal;
        display: swap;
      }

      @font-face {
        font-family: "Assistant";
        src: url(${OSS_FONTS_CDN}fonts/Assistant/Assistant-Medium.woff2)
            format("woff2"),
          url(./Assistant-Medium.woff2) format("woff2");
        font-weight: 500;
        style: normal;
        display: swap;
      }

      @font-face {
        font-family: "Assistant";
        src: url(${OSS_FONTS_CDN}fonts/Assistant/Assistant-SemiBold.woff2)
            format("woff2"),
          url(./Assistant-SemiBold.woff2) format("woff2");
        font-weight: 600;
        style: normal;
        display: swap;
      }

      @font-face {
        font-family: "Assistant";
        src: url(${OSS_FONTS_CDN}fonts/Assistant/Assistant-Bold.woff2)
            format("woff2"),
          url(./Assistant-Bold.woff2) format("woff2");
        font-weight: 700;
        style: normal;
        display: swap;
      }`;
          }
          if (!isDev && id.endsWith("excalidraw-app/index.html")) {
            return code.replace(
              "<!-- PLACEHOLDER:EXCALIDRAW_APP_FONTS -->",
              `<script>
        // point into our CDN in prod, fallback to root (excalidraw.com) domain in case of issues
        window.EXCALIDRAW_ASSET_PATH = [
          "${OSS_FONTS_CDN}",
          "${OSS_FONTS_FALLBACK}",
        ];
      </script>

      <!-- Preload all default fonts to avoid swap on init -->
      <link
        rel="preload"
        href="${OSS_FONTS_CDN}fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2"
        as="font"
        type="font/woff2"
        crossorigin="anonymous"
      />
      <!-- For Nunito only preload the latin range, which should be good enough for now -->
      <link
        rel="preload"
        href="${OSS_FONTS_CDN}fonts/Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTQ3j6zbXWjgeg.woff2"
        as="font"
        type="font/woff2"
        crossorigin="anonymous"
      />
      <link
        rel="preload"
        href="${OSS_FONTS_CDN}fonts/Assistant/Assistant-SemiBold.woff2"
        as="font"
        type="font/woff2"
        crossorigin="anonymous"
      />
      <link
        rel="preload"
        href="${OSS_FONTS_CDN}fonts/ComicShanns/ComicShanns-Regular-279a7b317d12eb88de06167bd672b4b4.woff2"
        as="font"
        type="font/woff2"
        crossorigin="anonymous"
      />
    `
            );
          }
        }
      };
    };
  }
});

// vite.config.mts
var import_woff2_vite_plugins = __toESM(require_woff2_vite_plugins(), 1);
import path from "path";
import { defineConfig, loadEnv } from "file:///C:/Users/Manan/Desktop/project/excalidraw/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/Manan/Desktop/project/excalidraw/node_modules/@vitejs/plugin-react/dist/index.mjs";
import svgrPlugin from "file:///C:/Users/Manan/Desktop/project/excalidraw/node_modules/vite-plugin-svgr/dist/index.js";
import { ViteEjsPlugin } from "file:///C:/Users/Manan/Desktop/project/excalidraw/node_modules/vite-plugin-ejs/index.js";
import { VitePWA } from "file:///C:/Users/Manan/Desktop/project/excalidraw/node_modules/vite-plugin-pwa/dist/index.js";
import checker from "file:///C:/Users/Manan/Desktop/project/excalidraw/node_modules/vite-plugin-checker/dist/esm/main.js";
import { createHtmlPlugin } from "file:///C:/Users/Manan/Desktop/project/excalidraw/node_modules/vite-plugin-html/dist/index.mjs";
import Sitemap from "file:///C:/Users/Manan/Desktop/project/excalidraw/node_modules/vite-plugin-sitemap/dist/index.js";

// app_routes.ts
var APP_ROUTES = {
  excalidrawPlusExport: "/excalidraw-plus-export",
  /** Sign in / sign up for the Plus server (`excalidraw-app/plus`). */
  signIn: "/signin",
  /** Scenes, collections and teams of the Plus server (`excalidraw-app/plus/dashboard`). */
  dashboard: "/dashboard"
};

// data/cacheMermaidChunks.ts
var MERMAID_CHUNKS_LIST_NAME = "mermaid-chunks";

// vite.config.mts
var __vite_injected_original_dirname = "C:\\Users\\Manan\\Desktop\\project\\excalidraw\\excalidraw-app";
var lazyChunksPlugin = (moduleRegex, lazyChunkFileNames, listName) => ({
  name: "excalidraw-lazy-chunks",
  apply: "build",
  generateBundle(_options, bundle) {
    const chunks = /* @__PURE__ */ new Map();
    for (const file of Object.values(bundle)) {
      if (file.type === "chunk") {
        chunks.set(file.fileName, file);
      }
    }
    const isLazyRoot = (chunk) => chunk.isDynamicEntry && !chunk.isEntry && chunk.moduleIds.some((id) => moduleRegex.test(id));
    const collectReachable = (roots, skipDynamicImport) => {
      const reachable = /* @__PURE__ */ new Set();
      const stack = [...roots];
      while (stack.length) {
        const chunk = stack.pop();
        if (reachable.has(chunk.fileName)) {
          continue;
        }
        reachable.add(chunk.fileName);
        for (const fileName of chunk.imports) {
          const next = chunks.get(fileName);
          if (next) {
            stack.push(next);
          }
        }
        for (const fileName of chunk.dynamicImports) {
          const next = chunks.get(fileName);
          if (next && !skipDynamicImport(next)) {
            stack.push(next);
          }
        }
      }
      return reachable;
    };
    const lazyRoots = [...chunks.values()].filter(isLazyRoot);
    if (!lazyRoots.length) {
      this.warn(`no lazy-loaded chunk found for ${moduleRegex}`);
    }
    const reachableOtherwise = collectReachable(
      [...chunks.values()].filter((chunk) => chunk.isEntry),
      isLazyRoot
    );
    for (const chunk of lazyRoots) {
      if (reachableOtherwise.has(chunk.fileName)) {
        this.warn(
          `${chunk.fileName} (matching ${moduleRegex}) is reachable without a dynamic import, so it's not lazy-loaded and stays precached`
        );
      }
    }
    lazyChunkFileNames.clear();
    for (const fileName of collectReachable(lazyRoots, () => false)) {
      if (!reachableOtherwise.has(fileName)) {
        lazyChunkFileNames.add(fileName);
      }
    }
    if (listName) {
      this.emitFile({
        type: "asset",
        name: `${listName}.json`,
        source: JSON.stringify([...lazyChunkFileNames])
      });
    }
  },
  // "post" handlers run in Vite's HTML plugin's `generateBundle`, after ours
  transformIndexHtml: {
    order: "post",
    handler: (_html, { bundle }) => {
      if (!listName) {
        return;
      }
      const list = Object.values(bundle ?? {}).find(
        (file) => file.type === "asset" && file.name === `${listName}.json`
      );
      if (!list) {
        throw new Error(`${listName}.json wasn't emitted`);
      }
      return [
        {
          tag: "meta",
          attrs: { name: listName, content: list.fileName },
          injectTo: "head"
        }
      ];
    }
  }
});
var vite_config_default = defineConfig(({ mode }) => {
  const envVars = loadEnv(mode, `../`);
  const mermaidChunkFileNames = /* @__PURE__ */ new Set();
  return {
    server: {
      port: Number(envVars.VITE_APP_PORT || 3e3),
      // open the browser
      open: true,
      // Excalidraw Plus server (plus-server/), same-origin so its session
      // cookie works: `yarn start:plus-server`
      proxy: {
        ...Object.fromEntries(
          ["/api", "/mcp"].map((prefix) => [
            prefix,
            {
              target: envVars.VITE_APP_PLUS_SERVER_URL || "http://localhost:3015",
              changeOrigin: true,
              // the scene realtime channel is a WebSocket
              ws: true
            }
          ])
        ),
        // local Claude bridge (claude-bridge/): `yarn start:claude-bridge`
        "/claude-bridge": {
          target: envVars.VITE_APP_CLAUDE_BRIDGE_URL || "http://127.0.0.1:3016"
        }
      }
    },
    // We need to specify the envDir since now there are no
    //more located in parallel with the vite.config.ts file but in parent dir
    envDir: "../",
    resolve: {
      alias: [
        {
          find: /^@excalidraw\/common$/,
          replacement: path.resolve(
            __vite_injected_original_dirname,
            "../packages/common/src/index.ts"
          )
        },
        {
          find: /^@excalidraw\/common\/(.*?)/,
          replacement: path.resolve(__vite_injected_original_dirname, "../packages/common/src/$1")
        },
        {
          find: /^@excalidraw\/element$/,
          replacement: path.resolve(
            __vite_injected_original_dirname,
            "../packages/element/src/index.ts"
          )
        },
        {
          find: /^@excalidraw\/element\/(.*?)/,
          replacement: path.resolve(__vite_injected_original_dirname, "../packages/element/src/$1")
        },
        {
          find: /^@excalidraw\/excalidraw$/,
          replacement: path.resolve(
            __vite_injected_original_dirname,
            "../packages/excalidraw/index.tsx"
          )
        },
        {
          find: /^@excalidraw\/excalidraw\/(.*?)/,
          replacement: path.resolve(__vite_injected_original_dirname, "../packages/excalidraw/$1")
        },
        {
          find: /^@excalidraw\/math$/,
          replacement: path.resolve(__vite_injected_original_dirname, "../packages/math/src/index.ts")
        },
        {
          find: /^@excalidraw\/math\/(.*?)/,
          replacement: path.resolve(__vite_injected_original_dirname, "../packages/math/src/$1")
        },
        {
          find: /^@excalidraw\/utils$/,
          replacement: path.resolve(
            __vite_injected_original_dirname,
            "../packages/utils/src/index.ts"
          )
        },
        {
          find: /^@excalidraw\/utils\/(.*?)/,
          replacement: path.resolve(__vite_injected_original_dirname, "../packages/utils/src/$1")
        },
        {
          find: /^@excalidraw\/fractional-indexing$/,
          replacement: path.resolve(
            __vite_injected_original_dirname,
            "../packages/fractional-indexing/src/index.ts"
          )
        },
        {
          find: /^@excalidraw\/laser-pointer$/,
          replacement: path.resolve(
            __vite_injected_original_dirname,
            "../packages/laser-pointer/src/index.ts"
          )
        }
      ]
    },
    build: {
      outDir: "build",
      rollupOptions: {
        output: {
          assetFileNames(chunkInfo) {
            if (chunkInfo?.name?.endsWith(".woff2")) {
              const family = chunkInfo.name.split("-")[0];
              return `fonts/${family}/[name][extname]`;
            }
            return "assets/[name]-[hash][extname]";
          },
          // Creating separate chunk for locales except for en and percentages.json so they
          // can be cached at runtime and not merged with
          // app precache. en.json and percentages.json are needed for first load
          // or fallback hence not clubbing with locales so first load followed by offline mode works fine. This is how CRA used to work too.
          manualChunks(id) {
            if (id === "\0vite/preload-helper.js" || id === "\0commonjsHelpers.js") {
              return "bundler-helpers";
            }
            if (id.includes("packages/excalidraw/locales") && id.match(/en.json|percentages.json/) === null) {
              const index = id.indexOf("locales/");
              return `locales/${id.substring(index + 8)}`;
            }
            if (id.includes("@codemirror/") || id.includes("@lezer/")) {
              return "codemirror.chunk";
            }
          }
        }
      },
      sourcemap: true,
      // don't auto-inline small assets (i.e. fonts hosted on CDN)
      assetsInlineLimit: 0
    },
    plugins: [
      Sitemap({
        hostname: "https://excalidraw.com",
        outDir: "build",
        exclude: ["/404"],
        changefreq: "monthly",
        // its static in public folder
        generateRobotsTxt: false
      }),
      (0, import_woff2_vite_plugins.woff2BrowserPlugin)(),
      lazyChunksPlugin(
        /[\\/]node_modules[\\/]@excalidraw[\\/]mermaid-to-excalidraw[\\/]/,
        mermaidChunkFileNames,
        MERMAID_CHUNKS_LIST_NAME
      ),
      react(),
      checker({
        typescript: true,
        eslint: envVars.VITE_APP_ENABLE_ESLINT === "false" ? void 0 : { lintCommand: 'eslint "./**/*.{js,ts,tsx}"' },
        overlay: {
          initialIsOpen: envVars.VITE_APP_COLLAPSE_OVERLAY === "false",
          badgeStyle: "margin-bottom: 4rem; margin-left: 1rem"
        }
      }),
      svgrPlugin(),
      ViteEjsPlugin(),
      VitePWA({
        registerType: "autoUpdate",
        devOptions: {
          /* set this flag to true to enable in Development mode */
          enabled: envVars.VITE_APP_ENABLE_PWA === "true"
        },
        workbox: {
          // Serve the cached app shell only for the paths the app lives on
          // (matched against pathname + search). Anything else goes to the
          // network, so that unknown paths get the server's 404.
          // To add a path, add it to APP_ROUTES.
          navigateFallbackAllowlist: [
            /^\/(\?|$)/,
            ...Object.values(APP_ROUTES).map(
              (route) => new RegExp(`^${route}(\\?|$)`)
            )
          ],
          // don't precache fonts, locales and separate chunks
          globIgnores: [
            "404.html",
            "fonts.css",
            "**/locales/**",
            "service-worker.js",
            "**/*.chunk-*.js",
            // CodeMirrorEditor can't be assigned a `.chunk` name via
            // manualChunks because Rollup would hoist shared deps (React)
            // via a static import from the main bundle, defeating lazy
            // loading. So we exclude it by name instead.
            "**/CodeMirrorEditor-*.js",
            // lazy-loaded Firebase SDK, only needed for collab/sharing, which
            // require network anyway
            "**/firebaseSDK-*.js"
          ],
          // mermaid chunks are excluded here rather than via `globIgnores`
          // as their file names are arbitrary
          manifestTransforms: [
            (entries) => ({
              manifest: entries.filter(
                (entry) => !mermaidChunkFileNames.has(entry.url)
              ),
              warnings: []
            })
          ],
          runtimeCaching: [
            {
              urlPattern: new RegExp(".+.woff2"),
              handler: "CacheFirst",
              options: {
                cacheName: "fonts",
                expiration: {
                  maxEntries: 1e3,
                  maxAgeSeconds: 60 * 60 * 24 * 90
                  // 90 days
                },
                cacheableResponse: {
                  // 0 to cache "opaque" responses from cross-origin requests (i.e. CDN)
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: new RegExp("fonts.css"),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "fonts",
                expiration: {
                  maxEntries: 50
                }
              }
            },
            {
              urlPattern: new RegExp("locales/[^/]+.js"),
              handler: "CacheFirst",
              options: {
                cacheName: "locales",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 30
                  // <== 30 days
                }
              }
            },
            {
              urlPattern: new RegExp("(.chunk-.+|CodeMirrorEditor-.+)\\.js"),
              handler: "CacheFirst",
              options: {
                cacheName: "chunk",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 90
                  // <== 90 days
                }
              }
            },
            {
              urlPattern: new RegExp("/assets/[^/]+\\.js$"),
              handler: "CacheFirst",
              options: {
                cacheName: "lazy-chunks",
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 90
                  // <== 90 days
                }
              }
            }
          ],
          maximumFileSizeToCacheInBytes: 2.3 * 1024 ** 2
          // 2.3MB
        },
        manifest: {
          short_name: "Excalidraw",
          name: "Excalidraw",
          description: "Excalidraw is a whiteboard tool that lets you easily sketch diagrams that have a hand-drawn feel to them.",
          icons: [
            {
              src: "android-chrome-192x192.png",
              sizes: "192x192",
              type: "image/png"
            },
            {
              src: "apple-touch-icon.png",
              type: "image/png",
              sizes: "180x180"
            },
            {
              src: "favicon-32x32.png",
              sizes: "32x32",
              type: "image/png"
            },
            {
              src: "favicon-16x16.png",
              sizes: "16x16",
              type: "image/png"
            }
          ],
          start_url: "/",
          id: "excalidraw",
          display: "standalone",
          orientation: "any",
          categories: ["productivity", "graphics"],
          theme_color: "#121212",
          background_color: "#ffffff",
          file_handlers: [
            {
              action: "/",
              accept: {
                "application/vnd.excalidraw+json": [".excalidraw"]
              }
            }
          ],
          screenshots: [
            {
              src: "/screenshots/virtual-whiteboard.png",
              type: "image/png",
              sizes: "462x945"
            },
            {
              src: "/screenshots/wireframe.png",
              type: "image/png",
              sizes: "462x945"
            },
            {
              src: "/screenshots/illustration.png",
              type: "image/png",
              sizes: "462x945"
            },
            {
              src: "/screenshots/shapes.png",
              type: "image/png",
              sizes: "462x945"
            },
            {
              src: "/screenshots/collaboration.png",
              type: "image/png",
              sizes: "462x945"
            },
            {
              src: "/screenshots/export.png",
              type: "image/png",
              sizes: "462x945"
            }
          ]
        }
      }),
      createHtmlPlugin({
        minify: true
      })
    ],
    publicDir: "../public"
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc2NyaXB0cy93b2ZmMi93b2ZmMi12aXRlLXBsdWdpbnMuanMiLCAidml0ZS5jb25maWcubXRzIiwgImFwcF9yb3V0ZXMudHMiLCAiZGF0YS9jYWNoZU1lcm1haWRDaHVua3MudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxNYW5hblxcXFxEZXNrdG9wXFxcXHByb2plY3RcXFxcZXhjYWxpZHJhd1xcXFxzY3JpcHRzXFxcXHdvZmYyXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxNYW5hblxcXFxEZXNrdG9wXFxcXHByb2plY3RcXFxcZXhjYWxpZHJhd1xcXFxzY3JpcHRzXFxcXHdvZmYyXFxcXHdvZmYyLXZpdGUtcGx1Z2lucy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvTWFuYW4vRGVza3RvcC9wcm9qZWN0L2V4Y2FsaWRyYXcvc2NyaXB0cy93b2ZmMi93b2ZmMi12aXRlLXBsdWdpbnMuanNcIjsvLyBkZWZpbmUgYEVYQ0FMSURSQVdfQVNTRVRfUEFUSGAgYXMgYSBTU09UXG5jb25zdCBPU1NfRk9OVFNfQ0ROID0gXCJodHRwczovL2V4Y2FsaWRyYXcubnljMy5jZG4uZGlnaXRhbG9jZWFuc3BhY2VzLmNvbS9vc3MvXCI7XG5jb25zdCBPU1NfRk9OVFNfRkFMTEJBQ0sgPSBcIi9cIjtcblxuLyoqXG4gKiBDdXN0b20gdml0ZSBwbHVnaW4gZm9yIGF1dG8tcHJlZml4aW5nIGBFWENBTElEUkFXX0FTU0VUX1BBVEhgIHdvZmYyIGZvbnRzIGluIGBleGNhbGlkcmF3LWFwcGAuXG4gKlxuICogQHJldHVybnMge2ltcG9ydChcInZpdGVcIikuUGx1Z2luT3B0aW9ufVxuICovXG5tb2R1bGUuZXhwb3J0cy53b2ZmMkJyb3dzZXJQbHVnaW4gPSAoKSA9PiB7XG4gIGxldCBpc0RldjtcblxuICByZXR1cm4ge1xuICAgIG5hbWU6IFwid29mZjJCcm93c2VyUGx1Z2luXCIsXG4gICAgZW5mb3JjZTogXCJwcmVcIixcbiAgICBjb25maWcoXywgeyBjb21tYW5kIH0pIHtcbiAgICAgIGlzRGV2ID0gY29tbWFuZCA9PT0gXCJzZXJ2ZVwiO1xuICAgIH0sXG4gICAgdHJhbnNmb3JtKGNvZGUsIGlkKSB7XG4gICAgICAvLyB1c2luZyBjb3B5IC8gcmVwbGFjZSBhcyBmb250cyBkZWZpbmVkIGluIHRoZSBgLmNzc2AgZG9uJ3QgaGF2ZSB0byBiZSBtYW51YWxseSBjb3BpZWQgb3ZlciAodml0ZS9yb2xsdXAgZG9lcyB0aGlzIGF1dG9tYXRpY2FsbHkpLFxuICAgICAgLy8gYnV0IGF0IHRoZSBzYW1lIHRpbWUgY2FuJ3QgYmUgZWFzaWx5IHByZWZpeGVkIHdpdGggdGhlIGBFWENBTElEUkFXX0FTU0VUX1BBVEhgIG9ubHkgZm9yIHRoZSBgZXhjYWxpZHJhdy1hcHBgXG4gICAgICBpZiAoIWlzRGV2ICYmIGlkLmVuZHNXaXRoKFwiL2V4Y2FsaWRyYXcvZm9udHMvZm9udHMuY3NzXCIpKSB7XG4gICAgICAgIHJldHVybiBgLyogV0FSTjogVGhlIGZvbGxvd2luZyBjb250ZW50IGlzIGdlbmVyYXRlZCBkdXJpbmcgZXhjYWxpZHJhdy1hcHAgYnVpbGQgKi9cblxuICAgICAgQGZvbnQtZmFjZSB7XG4gICAgICAgIGZvbnQtZmFtaWx5OiBcIkFzc2lzdGFudFwiO1xuICAgICAgICBzcmM6IHVybCgke09TU19GT05UU19DRE59Zm9udHMvQXNzaXN0YW50L0Fzc2lzdGFudC1SZWd1bGFyLndvZmYyKVxuICAgICAgICAgICAgZm9ybWF0KFwid29mZjJcIiksXG4gICAgICAgICAgdXJsKC4vQXNzaXN0YW50LVJlZ3VsYXIud29mZjIpIGZvcm1hdChcIndvZmYyXCIpO1xuICAgICAgICBmb250LXdlaWdodDogNDAwO1xuICAgICAgICBzdHlsZTogbm9ybWFsO1xuICAgICAgICBkaXNwbGF5OiBzd2FwO1xuICAgICAgfVxuXG4gICAgICBAZm9udC1mYWNlIHtcbiAgICAgICAgZm9udC1mYW1pbHk6IFwiQXNzaXN0YW50XCI7XG4gICAgICAgIHNyYzogdXJsKCR7T1NTX0ZPTlRTX0NETn1mb250cy9Bc3Npc3RhbnQvQXNzaXN0YW50LU1lZGl1bS53b2ZmMilcbiAgICAgICAgICAgIGZvcm1hdChcIndvZmYyXCIpLFxuICAgICAgICAgIHVybCguL0Fzc2lzdGFudC1NZWRpdW0ud29mZjIpIGZvcm1hdChcIndvZmYyXCIpO1xuICAgICAgICBmb250LXdlaWdodDogNTAwO1xuICAgICAgICBzdHlsZTogbm9ybWFsO1xuICAgICAgICBkaXNwbGF5OiBzd2FwO1xuICAgICAgfVxuXG4gICAgICBAZm9udC1mYWNlIHtcbiAgICAgICAgZm9udC1mYW1pbHk6IFwiQXNzaXN0YW50XCI7XG4gICAgICAgIHNyYzogdXJsKCR7T1NTX0ZPTlRTX0NETn1mb250cy9Bc3Npc3RhbnQvQXNzaXN0YW50LVNlbWlCb2xkLndvZmYyKVxuICAgICAgICAgICAgZm9ybWF0KFwid29mZjJcIiksXG4gICAgICAgICAgdXJsKC4vQXNzaXN0YW50LVNlbWlCb2xkLndvZmYyKSBmb3JtYXQoXCJ3b2ZmMlwiKTtcbiAgICAgICAgZm9udC13ZWlnaHQ6IDYwMDtcbiAgICAgICAgc3R5bGU6IG5vcm1hbDtcbiAgICAgICAgZGlzcGxheTogc3dhcDtcbiAgICAgIH1cblxuICAgICAgQGZvbnQtZmFjZSB7XG4gICAgICAgIGZvbnQtZmFtaWx5OiBcIkFzc2lzdGFudFwiO1xuICAgICAgICBzcmM6IHVybCgke09TU19GT05UU19DRE59Zm9udHMvQXNzaXN0YW50L0Fzc2lzdGFudC1Cb2xkLndvZmYyKVxuICAgICAgICAgICAgZm9ybWF0KFwid29mZjJcIiksXG4gICAgICAgICAgdXJsKC4vQXNzaXN0YW50LUJvbGQud29mZjIpIGZvcm1hdChcIndvZmYyXCIpO1xuICAgICAgICBmb250LXdlaWdodDogNzAwO1xuICAgICAgICBzdHlsZTogbm9ybWFsO1xuICAgICAgICBkaXNwbGF5OiBzd2FwO1xuICAgICAgfWA7XG4gICAgICB9XG5cbiAgICAgIGlmICghaXNEZXYgJiYgaWQuZW5kc1dpdGgoXCJleGNhbGlkcmF3LWFwcC9pbmRleC5odG1sXCIpKSB7XG4gICAgICAgIHJldHVybiBjb2RlLnJlcGxhY2UoXG4gICAgICAgICAgXCI8IS0tIFBMQUNFSE9MREVSOkVYQ0FMSURSQVdfQVBQX0ZPTlRTIC0tPlwiLFxuICAgICAgICAgIGA8c2NyaXB0PlxuICAgICAgICAvLyBwb2ludCBpbnRvIG91ciBDRE4gaW4gcHJvZCwgZmFsbGJhY2sgdG8gcm9vdCAoZXhjYWxpZHJhdy5jb20pIGRvbWFpbiBpbiBjYXNlIG9mIGlzc3Vlc1xuICAgICAgICB3aW5kb3cuRVhDQUxJRFJBV19BU1NFVF9QQVRIID0gW1xuICAgICAgICAgIFwiJHtPU1NfRk9OVFNfQ0ROfVwiLFxuICAgICAgICAgIFwiJHtPU1NfRk9OVFNfRkFMTEJBQ0t9XCIsXG4gICAgICAgIF07XG4gICAgICA8L3NjcmlwdD5cblxuICAgICAgPCEtLSBQcmVsb2FkIGFsbCBkZWZhdWx0IGZvbnRzIHRvIGF2b2lkIHN3YXAgb24gaW5pdCAtLT5cbiAgICAgIDxsaW5rXG4gICAgICAgIHJlbD1cInByZWxvYWRcIlxuICAgICAgICBocmVmPVwiJHtPU1NfRk9OVFNfQ0ROfWZvbnRzL0V4Y2FsaWZvbnQvRXhjYWxpZm9udC1SZWd1bGFyLWE4OGI3MmEyNGZiNTRjOWY5NGUzYjVmZGFhNzQ4MWM5LndvZmYyXCJcbiAgICAgICAgYXM9XCJmb250XCJcbiAgICAgICAgdHlwZT1cImZvbnQvd29mZjJcIlxuICAgICAgICBjcm9zc29yaWdpbj1cImFub255bW91c1wiXG4gICAgICAvPlxuICAgICAgPCEtLSBGb3IgTnVuaXRvIG9ubHkgcHJlbG9hZCB0aGUgbGF0aW4gcmFuZ2UsIHdoaWNoIHNob3VsZCBiZSBnb29kIGVub3VnaCBmb3Igbm93IC0tPlxuICAgICAgPGxpbmtcbiAgICAgICAgcmVsPVwicHJlbG9hZFwiXG4gICAgICAgIGhyZWY9XCIke09TU19GT05UU19DRE59Zm9udHMvTnVuaXRvL051bml0by1SZWd1bGFyLVhSWEkzSTZMaTAxQktvZmlPYzV3dGxaMmRpOEhESWtoZFRRM2o2emJYV2pnZWcud29mZjJcIlxuICAgICAgICBhcz1cImZvbnRcIlxuICAgICAgICB0eXBlPVwiZm9udC93b2ZmMlwiXG4gICAgICAgIGNyb3Nzb3JpZ2luPVwiYW5vbnltb3VzXCJcbiAgICAgIC8+XG4gICAgICA8bGlua1xuICAgICAgICByZWw9XCJwcmVsb2FkXCJcbiAgICAgICAgaHJlZj1cIiR7T1NTX0ZPTlRTX0NETn1mb250cy9Bc3Npc3RhbnQvQXNzaXN0YW50LVNlbWlCb2xkLndvZmYyXCJcbiAgICAgICAgYXM9XCJmb250XCJcbiAgICAgICAgdHlwZT1cImZvbnQvd29mZjJcIlxuICAgICAgICBjcm9zc29yaWdpbj1cImFub255bW91c1wiXG4gICAgICAvPlxuICAgICAgPGxpbmtcbiAgICAgICAgcmVsPVwicHJlbG9hZFwiXG4gICAgICAgIGhyZWY9XCIke09TU19GT05UU19DRE59Zm9udHMvQ29taWNTaGFubnMvQ29taWNTaGFubnMtUmVndWxhci0yNzlhN2IzMTdkMTJlYjg4ZGUwNjE2N2JkNjcyYjRiNC53b2ZmMlwiXG4gICAgICAgIGFzPVwiZm9udFwiXG4gICAgICAgIHR5cGU9XCJmb250L3dvZmYyXCJcbiAgICAgICAgY3Jvc3NvcmlnaW49XCJhbm9ueW1vdXNcIlxuICAgICAgLz5cbiAgICBgLFxuICAgICAgICApO1xuICAgICAgfVxuICAgIH0sXG4gIH07XG59O1xuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxNYW5hblxcXFxEZXNrdG9wXFxcXHByb2plY3RcXFxcZXhjYWxpZHJhd1xcXFxleGNhbGlkcmF3LWFwcFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiQzpcXFxcVXNlcnNcXFxcTWFuYW5cXFxcRGVza3RvcFxcXFxwcm9qZWN0XFxcXGV4Y2FsaWRyYXdcXFxcZXhjYWxpZHJhdy1hcHBcXFxcdml0ZS5jb25maWcubXRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy9NYW5hbi9EZXNrdG9wL3Byb2plY3QvZXhjYWxpZHJhdy9leGNhbGlkcmF3LWFwcC92aXRlLmNvbmZpZy5tdHNcIjtpbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnLCBsb2FkRW52IH0gZnJvbSBcInZpdGVcIjtcbmltcG9ydCByZWFjdCBmcm9tIFwiQHZpdGVqcy9wbHVnaW4tcmVhY3RcIjtcbmltcG9ydCBzdmdyUGx1Z2luIGZyb20gXCJ2aXRlLXBsdWdpbi1zdmdyXCI7XG5pbXBvcnQgeyBWaXRlRWpzUGx1Z2luIH0gZnJvbSBcInZpdGUtcGx1Z2luLWVqc1wiO1xuaW1wb3J0IHsgVml0ZVBXQSB9IGZyb20gXCJ2aXRlLXBsdWdpbi1wd2FcIjtcbmltcG9ydCBjaGVja2VyIGZyb20gXCJ2aXRlLXBsdWdpbi1jaGVja2VyXCI7XG5pbXBvcnQgeyBjcmVhdGVIdG1sUGx1Z2luIH0gZnJvbSBcInZpdGUtcGx1Z2luLWh0bWxcIjtcbmltcG9ydCBTaXRlbWFwIGZyb20gXCJ2aXRlLXBsdWdpbi1zaXRlbWFwXCI7XG5pbXBvcnQgeyB3b2ZmMkJyb3dzZXJQbHVnaW4gfSBmcm9tIFwiLi4vc2NyaXB0cy93b2ZmMi93b2ZmMi12aXRlLXBsdWdpbnNcIjtcblxuaW1wb3J0IHsgQVBQX1JPVVRFUyB9IGZyb20gXCIuL2FwcF9yb3V0ZXNcIjtcbmltcG9ydCB7IE1FUk1BSURfQ0hVTktTX0xJU1RfTkFNRSB9IGZyb20gXCIuL2RhdGEvY2FjaGVNZXJtYWlkQ2h1bmtzXCI7XG5cbmltcG9ydCB0eXBlIHsgUGx1Z2luLCBSb2xsdXAgfSBmcm9tIFwidml0ZVwiO1xuXG4vKipcbiAqIENvbGxlY3RzIGludG8gYGxhenlDaHVua0ZpbGVOYW1lc2AgdGhlIGNodW5rcyByZWFjaGFibGUgb25seSB2aWEgYSBkeW5hbWljXG4gKiBpbXBvcnQgb2YgYSBtb2R1bGUgbWF0Y2hpbmcgYG1vZHVsZVJlZ2V4YCwgc28gd2UgY2FuIGV4Y2x1ZGUgdGhlbSBmcm9tIHRoZVxuICogUFdBIHByZWNhY2hlLiBOZWVkZWQgZm9yIGxhcmdlIGxhenkgZGVwcyB0aGF0IFJvbGx1cCBzcGxpdHMgaW50byBtYW55XG4gKiBhcmJpdHJhcmlseSBuYW1lZCBjaHVua3MgKGUuZy4gbWVybWFpZCksIHdoaWNoIGBnbG9iSWdub3Jlc2AgY2FuJ3QgdGFyZ2V0LlxuICpcbiAqIFdpdGggYGxpc3ROYW1lYCwgdGhlaXIgZmlsZSBuYW1lcyBhcmUgYWxzbyBlbWl0dGVkIGFzIGEgSlNPTiBhc3NldCB0aGF0XG4gKiBpbmRleC5odG1sIHBvaW50cyB0byAoYDxtZXRhIG5hbWU9e2xpc3ROYW1lfSBjb250ZW50PXtmaWxlTmFtZX0+YCksIGZvciB0aGVcbiAqIGFwcCB0byBjYWNoZSB0aGVtIHdoZW4gaXQgbmVlZHMgdGhlbS5cbiAqL1xuY29uc3QgbGF6eUNodW5rc1BsdWdpbiA9IChcbiAgbW9kdWxlUmVnZXg6IFJlZ0V4cCxcbiAgbGF6eUNodW5rRmlsZU5hbWVzOiBTZXQ8c3RyaW5nPixcbiAgbGlzdE5hbWU/OiBzdHJpbmcsXG4pOiBQbHVnaW4gPT4gKHtcbiAgbmFtZTogXCJleGNhbGlkcmF3LWxhenktY2h1bmtzXCIsXG4gIGFwcGx5OiBcImJ1aWxkXCIsXG4gIGdlbmVyYXRlQnVuZGxlKF9vcHRpb25zLCBidW5kbGUpIHtcbiAgICBjb25zdCBjaHVua3MgPSBuZXcgTWFwPHN0cmluZywgUm9sbHVwLk91dHB1dENodW5rPigpO1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiBPYmplY3QudmFsdWVzKGJ1bmRsZSkpIHtcbiAgICAgIGlmIChmaWxlLnR5cGUgPT09IFwiY2h1bmtcIikge1xuICAgICAgICBjaHVua3Muc2V0KGZpbGUuZmlsZU5hbWUsIGZpbGUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIHRoZSBkeW5hbWljYWxseSBpbXBvcnRlZCBtb2R1bGUgbWF5IHNoYXJlIGl0cyBjaHVuayB3aXRoIGl0cyBkZXBzXG4gICAgLy8gKG5vIGBmYWNhZGVNb2R1bGVJZGAgdGhlbiksIHNvIG1hdGNoIG9uIGFueSBjb250YWluZWQgbW9kdWxlXG4gICAgY29uc3QgaXNMYXp5Um9vdCA9IChjaHVuazogUm9sbHVwLk91dHB1dENodW5rKSA9PlxuICAgICAgY2h1bmsuaXNEeW5hbWljRW50cnkgJiZcbiAgICAgICFjaHVuay5pc0VudHJ5ICYmXG4gICAgICBjaHVuay5tb2R1bGVJZHMuc29tZSgoaWQpID0+IG1vZHVsZVJlZ2V4LnRlc3QoaWQpKTtcblxuICAgIGNvbnN0IGNvbGxlY3RSZWFjaGFibGUgPSAoXG4gICAgICByb290czogUm9sbHVwLk91dHB1dENodW5rW10sXG4gICAgICBza2lwRHluYW1pY0ltcG9ydDogKGNodW5rOiBSb2xsdXAuT3V0cHV0Q2h1bmspID0+IGJvb2xlYW4sXG4gICAgKSA9PiB7XG4gICAgICBjb25zdCByZWFjaGFibGUgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgIGNvbnN0IHN0YWNrID0gWy4uLnJvb3RzXTtcbiAgICAgIHdoaWxlIChzdGFjay5sZW5ndGgpIHtcbiAgICAgICAgY29uc3QgY2h1bmsgPSBzdGFjay5wb3AoKSE7XG4gICAgICAgIGlmIChyZWFjaGFibGUuaGFzKGNodW5rLmZpbGVOYW1lKSkge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIHJlYWNoYWJsZS5hZGQoY2h1bmsuZmlsZU5hbWUpO1xuICAgICAgICAvLyBzdGF0aWMgaW1wb3J0cyBhcmUgYWx3YXlzIGZvbGxvd2VkOiB0aGV5J3JlIG5lZWRlZCB3aGVuZXZlciB0aGVcbiAgICAgICAgLy8gaW1wb3J0aW5nIGNodW5rIGlzIGxvYWRlZFxuICAgICAgICBmb3IgKGNvbnN0IGZpbGVOYW1lIG9mIGNodW5rLmltcG9ydHMpIHtcbiAgICAgICAgICBjb25zdCBuZXh0ID0gY2h1bmtzLmdldChmaWxlTmFtZSk7XG4gICAgICAgICAgaWYgKG5leHQpIHtcbiAgICAgICAgICAgIHN0YWNrLnB1c2gobmV4dCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZmlsZU5hbWUgb2YgY2h1bmsuZHluYW1pY0ltcG9ydHMpIHtcbiAgICAgICAgICBjb25zdCBuZXh0ID0gY2h1bmtzLmdldChmaWxlTmFtZSk7XG4gICAgICAgICAgaWYgKG5leHQgJiYgIXNraXBEeW5hbWljSW1wb3J0KG5leHQpKSB7XG4gICAgICAgICAgICBzdGFjay5wdXNoKG5leHQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHJlYWNoYWJsZTtcbiAgICB9O1xuXG4gICAgY29uc3QgbGF6eVJvb3RzID0gWy4uLmNodW5rcy52YWx1ZXMoKV0uZmlsdGVyKGlzTGF6eVJvb3QpO1xuICAgIGlmICghbGF6eVJvb3RzLmxlbmd0aCkge1xuICAgICAgdGhpcy53YXJuKGBubyBsYXp5LWxvYWRlZCBjaHVuayBmb3VuZCBmb3IgJHttb2R1bGVSZWdleH1gKTtcbiAgICB9XG5cbiAgICAvLyBhbnl0aGluZyBhbHNvIHJlYWNoYWJsZSB3aXRob3V0IGR5bmFtaWNhbGx5IGltcG9ydGluZyB0aGUgbGF6eSByb290c1xuICAgIC8vIChlLmcuIGRlcHMgc2hhcmVkIHdpdGggdGhlIG1haW4gYnVuZGxlLCBvciBhIGxhenkgcm9vdCB0aGF0IFJvbGx1cFxuICAgIC8vIG1lcmdlZCBpbnRvIGEgc3RhdGljYWxseSBpbXBvcnRlZCBjaHVuaykgbXVzdCBzdGF5IHByZWNhY2hlZFxuICAgIGNvbnN0IHJlYWNoYWJsZU90aGVyd2lzZSA9IGNvbGxlY3RSZWFjaGFibGUoXG4gICAgICBbLi4uY2h1bmtzLnZhbHVlcygpXS5maWx0ZXIoKGNodW5rKSA9PiBjaHVuay5pc0VudHJ5KSxcbiAgICAgIGlzTGF6eVJvb3QsXG4gICAgKTtcblxuICAgIGZvciAoY29uc3QgY2h1bmsgb2YgbGF6eVJvb3RzKSB7XG4gICAgICBpZiAocmVhY2hhYmxlT3RoZXJ3aXNlLmhhcyhjaHVuay5maWxlTmFtZSkpIHtcbiAgICAgICAgdGhpcy53YXJuKFxuICAgICAgICAgIGAke2NodW5rLmZpbGVOYW1lfSAobWF0Y2hpbmcgJHttb2R1bGVSZWdleH0pIGlzIHJlYWNoYWJsZSB3aXRob3V0IGEgZHluYW1pYyBpbXBvcnQsIHNvIGl0J3Mgbm90IGxhenktbG9hZGVkIGFuZCBzdGF5cyBwcmVjYWNoZWRgLFxuICAgICAgICApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGxhenlDaHVua0ZpbGVOYW1lcy5jbGVhcigpO1xuICAgIGZvciAoY29uc3QgZmlsZU5hbWUgb2YgY29sbGVjdFJlYWNoYWJsZShsYXp5Um9vdHMsICgpID0+IGZhbHNlKSkge1xuICAgICAgaWYgKCFyZWFjaGFibGVPdGhlcndpc2UuaGFzKGZpbGVOYW1lKSkge1xuICAgICAgICBsYXp5Q2h1bmtGaWxlTmFtZXMuYWRkKGZpbGVOYW1lKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAobGlzdE5hbWUpIHtcbiAgICAgIHRoaXMuZW1pdEZpbGUoe1xuICAgICAgICB0eXBlOiBcImFzc2V0XCIsXG4gICAgICAgIG5hbWU6IGAke2xpc3ROYW1lfS5qc29uYCxcbiAgICAgICAgc291cmNlOiBKU09OLnN0cmluZ2lmeShbLi4ubGF6eUNodW5rRmlsZU5hbWVzXSksXG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG4gIC8vIFwicG9zdFwiIGhhbmRsZXJzIHJ1biBpbiBWaXRlJ3MgSFRNTCBwbHVnaW4ncyBgZ2VuZXJhdGVCdW5kbGVgLCBhZnRlciBvdXJzXG4gIHRyYW5zZm9ybUluZGV4SHRtbDoge1xuICAgIG9yZGVyOiBcInBvc3RcIixcbiAgICBoYW5kbGVyOiAoX2h0bWwsIHsgYnVuZGxlIH0pID0+IHtcbiAgICAgIGlmICghbGlzdE5hbWUpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY29uc3QgbGlzdCA9IE9iamVjdC52YWx1ZXMoYnVuZGxlID8/IHt9KS5maW5kKFxuICAgICAgICAoZmlsZSkgPT4gZmlsZS50eXBlID09PSBcImFzc2V0XCIgJiYgZmlsZS5uYW1lID09PSBgJHtsaXN0TmFtZX0uanNvbmAsXG4gICAgICApO1xuICAgICAgaWYgKCFsaXN0KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtsaXN0TmFtZX0uanNvbiB3YXNuJ3QgZW1pdHRlZGApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIFtcbiAgICAgICAge1xuICAgICAgICAgIHRhZzogXCJtZXRhXCIsXG4gICAgICAgICAgYXR0cnM6IHsgbmFtZTogbGlzdE5hbWUsIGNvbnRlbnQ6IGxpc3QuZmlsZU5hbWUgfSxcbiAgICAgICAgICBpbmplY3RUbzogXCJoZWFkXCIsXG4gICAgICAgIH0sXG4gICAgICBdO1xuICAgIH0sXG4gIH0sXG59KTtcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKCh7IG1vZGUgfSkgPT4ge1xuICAvLyBUbyBsb2FkIC5lbnYgdmFyaWFibGVzXG4gIGNvbnN0IGVudlZhcnMgPSBsb2FkRW52KG1vZGUsIGAuLi9gKTtcbiAgLy8gbWVybWFpZCAoKyBpdHMgbWFueSBkZXBzICYgcGVyLWRpYWdyYW0gY2h1bmtzKSBpcyBsYXp5LWxvYWRlZCBhbmQgbGFyZ2UsXG4gIC8vIHNvIHdlIGRvbid0IHByZWNhY2hlIGl0ICh0aGUgYXBwIGNhY2hlcyBpdCBvbmNlIHRoZSBUVEQgZGlhbG9nIGlzIG9wZW5lZCxcbiAgLy8gc2VlIGBjYWNoZU1lcm1haWRDaHVua3NgKS4gUG9wdWxhdGVkIGF0IGJ1aWxkIHRpbWUgYnkgYGxhenlDaHVua3NQbHVnaW5gLlxuICBjb25zdCBtZXJtYWlkQ2h1bmtGaWxlTmFtZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbiAgcmV0dXJuIHtcbiAgICBzZXJ2ZXI6IHtcbiAgICAgIHBvcnQ6IE51bWJlcihlbnZWYXJzLlZJVEVfQVBQX1BPUlQgfHwgMzAwMCksXG4gICAgICAvLyBvcGVuIHRoZSBicm93c2VyXG4gICAgICBvcGVuOiB0cnVlLFxuICAgICAgLy8gRXhjYWxpZHJhdyBQbHVzIHNlcnZlciAocGx1cy1zZXJ2ZXIvKSwgc2FtZS1vcmlnaW4gc28gaXRzIHNlc3Npb25cbiAgICAgIC8vIGNvb2tpZSB3b3JrczogYHlhcm4gc3RhcnQ6cGx1cy1zZXJ2ZXJgXG4gICAgICBwcm94eToge1xuICAgICAgICAuLi5PYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICAgICAgW1wiL2FwaVwiLCBcIi9tY3BcIl0ubWFwKChwcmVmaXgpID0+IFtcbiAgICAgICAgICAgIHByZWZpeCxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdGFyZ2V0OlxuICAgICAgICAgICAgICAgIGVudlZhcnMuVklURV9BUFBfUExVU19TRVJWRVJfVVJMIHx8IFwiaHR0cDovL2xvY2FsaG9zdDozMDE1XCIsXG4gICAgICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgICAgICAgICAgLy8gdGhlIHNjZW5lIHJlYWx0aW1lIGNoYW5uZWwgaXMgYSBXZWJTb2NrZXRcbiAgICAgICAgICAgICAgd3M6IHRydWUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0pLFxuICAgICAgICApLFxuICAgICAgICAvLyBsb2NhbCBDbGF1ZGUgYnJpZGdlIChjbGF1ZGUtYnJpZGdlLyk6IGB5YXJuIHN0YXJ0OmNsYXVkZS1icmlkZ2VgXG4gICAgICAgIFwiL2NsYXVkZS1icmlkZ2VcIjoge1xuICAgICAgICAgIHRhcmdldDogZW52VmFycy5WSVRFX0FQUF9DTEFVREVfQlJJREdFX1VSTCB8fCBcImh0dHA6Ly8xMjcuMC4wLjE6MzAxNlwiLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICAgIC8vIFdlIG5lZWQgdG8gc3BlY2lmeSB0aGUgZW52RGlyIHNpbmNlIG5vdyB0aGVyZSBhcmUgbm9cbiAgICAvL21vcmUgbG9jYXRlZCBpbiBwYXJhbGxlbCB3aXRoIHRoZSB2aXRlLmNvbmZpZy50cyBmaWxlIGJ1dCBpbiBwYXJlbnQgZGlyXG4gICAgZW52RGlyOiBcIi4uL1wiLFxuICAgIHJlc29sdmU6IHtcbiAgICAgIGFsaWFzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBmaW5kOiAvXkBleGNhbGlkcmF3XFwvY29tbW9uJC8sXG4gICAgICAgICAgcmVwbGFjZW1lbnQ6IHBhdGgucmVzb2x2ZShcbiAgICAgICAgICAgIF9fZGlybmFtZSxcbiAgICAgICAgICAgIFwiLi4vcGFja2FnZXMvY29tbW9uL3NyYy9pbmRleC50c1wiLFxuICAgICAgICAgICksXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBmaW5kOiAvXkBleGNhbGlkcmF3XFwvY29tbW9uXFwvKC4qPykvLFxuICAgICAgICAgIHJlcGxhY2VtZW50OiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4uL3BhY2thZ2VzL2NvbW1vbi9zcmMvJDFcIiksXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBmaW5kOiAvXkBleGNhbGlkcmF3XFwvZWxlbWVudCQvLFxuICAgICAgICAgIHJlcGxhY2VtZW50OiBwYXRoLnJlc29sdmUoXG4gICAgICAgICAgICBfX2Rpcm5hbWUsXG4gICAgICAgICAgICBcIi4uL3BhY2thZ2VzL2VsZW1lbnQvc3JjL2luZGV4LnRzXCIsXG4gICAgICAgICAgKSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGZpbmQ6IC9eQGV4Y2FsaWRyYXdcXC9lbGVtZW50XFwvKC4qPykvLFxuICAgICAgICAgIHJlcGxhY2VtZW50OiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4uL3BhY2thZ2VzL2VsZW1lbnQvc3JjLyQxXCIpLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgZmluZDogL15AZXhjYWxpZHJhd1xcL2V4Y2FsaWRyYXckLyxcbiAgICAgICAgICByZXBsYWNlbWVudDogcGF0aC5yZXNvbHZlKFxuICAgICAgICAgICAgX19kaXJuYW1lLFxuICAgICAgICAgICAgXCIuLi9wYWNrYWdlcy9leGNhbGlkcmF3L2luZGV4LnRzeFwiLFxuICAgICAgICAgICksXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBmaW5kOiAvXkBleGNhbGlkcmF3XFwvZXhjYWxpZHJhd1xcLyguKj8pLyxcbiAgICAgICAgICByZXBsYWNlbWVudDogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuLi9wYWNrYWdlcy9leGNhbGlkcmF3LyQxXCIpLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgZmluZDogL15AZXhjYWxpZHJhd1xcL21hdGgkLyxcbiAgICAgICAgICByZXBsYWNlbWVudDogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuLi9wYWNrYWdlcy9tYXRoL3NyYy9pbmRleC50c1wiKSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGZpbmQ6IC9eQGV4Y2FsaWRyYXdcXC9tYXRoXFwvKC4qPykvLFxuICAgICAgICAgIHJlcGxhY2VtZW50OiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4uL3BhY2thZ2VzL21hdGgvc3JjLyQxXCIpLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgZmluZDogL15AZXhjYWxpZHJhd1xcL3V0aWxzJC8sXG4gICAgICAgICAgcmVwbGFjZW1lbnQ6IHBhdGgucmVzb2x2ZShcbiAgICAgICAgICAgIF9fZGlybmFtZSxcbiAgICAgICAgICAgIFwiLi4vcGFja2FnZXMvdXRpbHMvc3JjL2luZGV4LnRzXCIsXG4gICAgICAgICAgKSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGZpbmQ6IC9eQGV4Y2FsaWRyYXdcXC91dGlsc1xcLyguKj8pLyxcbiAgICAgICAgICByZXBsYWNlbWVudDogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuLi9wYWNrYWdlcy91dGlscy9zcmMvJDFcIiksXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBmaW5kOiAvXkBleGNhbGlkcmF3XFwvZnJhY3Rpb25hbC1pbmRleGluZyQvLFxuICAgICAgICAgIHJlcGxhY2VtZW50OiBwYXRoLnJlc29sdmUoXG4gICAgICAgICAgICBfX2Rpcm5hbWUsXG4gICAgICAgICAgICBcIi4uL3BhY2thZ2VzL2ZyYWN0aW9uYWwtaW5kZXhpbmcvc3JjL2luZGV4LnRzXCIsXG4gICAgICAgICAgKSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGZpbmQ6IC9eQGV4Y2FsaWRyYXdcXC9sYXNlci1wb2ludGVyJC8sXG4gICAgICAgICAgcmVwbGFjZW1lbnQ6IHBhdGgucmVzb2x2ZShcbiAgICAgICAgICAgIF9fZGlybmFtZSxcbiAgICAgICAgICAgIFwiLi4vcGFja2FnZXMvbGFzZXItcG9pbnRlci9zcmMvaW5kZXgudHNcIixcbiAgICAgICAgICApLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9LFxuICAgIGJ1aWxkOiB7XG4gICAgICBvdXREaXI6IFwiYnVpbGRcIixcbiAgICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgICAgb3V0cHV0OiB7XG4gICAgICAgICAgYXNzZXRGaWxlTmFtZXMoY2h1bmtJbmZvKSB7XG4gICAgICAgICAgICBpZiAoY2h1bmtJbmZvPy5uYW1lPy5lbmRzV2l0aChcIi53b2ZmMlwiKSkge1xuICAgICAgICAgICAgICBjb25zdCBmYW1pbHkgPSBjaHVua0luZm8ubmFtZS5zcGxpdChcIi1cIilbMF07XG4gICAgICAgICAgICAgIHJldHVybiBgZm9udHMvJHtmYW1pbHl9L1tuYW1lXVtleHRuYW1lXWA7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBcImFzc2V0cy9bbmFtZV0tW2hhc2hdW2V4dG5hbWVdXCI7XG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyBDcmVhdGluZyBzZXBhcmF0ZSBjaHVuayBmb3IgbG9jYWxlcyBleGNlcHQgZm9yIGVuIGFuZCBwZXJjZW50YWdlcy5qc29uIHNvIHRoZXlcbiAgICAgICAgICAvLyBjYW4gYmUgY2FjaGVkIGF0IHJ1bnRpbWUgYW5kIG5vdCBtZXJnZWQgd2l0aFxuICAgICAgICAgIC8vIGFwcCBwcmVjYWNoZS4gZW4uanNvbiBhbmQgcGVyY2VudGFnZXMuanNvbiBhcmUgbmVlZGVkIGZvciBmaXJzdCBsb2FkXG4gICAgICAgICAgLy8gb3IgZmFsbGJhY2sgaGVuY2Ugbm90IGNsdWJiaW5nIHdpdGggbG9jYWxlcyBzbyBmaXJzdCBsb2FkIGZvbGxvd2VkIGJ5IG9mZmxpbmUgbW9kZSB3b3JrcyBmaW5lLiBUaGlzIGlzIGhvdyBDUkEgdXNlZCB0byB3b3JrIHRvby5cbiAgICAgICAgICBtYW51YWxDaHVua3MoaWQpIHtcbiAgICAgICAgICAgIC8vIEJ1bmRsZXIgcnVudGltZSBoZWxwZXJzIChkeW5hbWljIGltcG9ydCBwcmVsb2FkaW5nLCBDSlMgaW50ZXJvcClcbiAgICAgICAgICAgIC8vIHdvdWxkIG90aGVyd2lzZSBsaXZlIGluIHRoZSBtYWluIGJ1bmRsZSwgYW5kIGV2ZXJ5IGxhenkgY2h1bmtcbiAgICAgICAgICAgIC8vIGltcG9ydGluZyB0aGVtIHdvdWxkIGdldCBhIG5ldyBmaWxlIG5hbWUgd2l0aCBlYWNoIGRlcGxveS4gVGFic1xuICAgICAgICAgICAgLy8gc3RpbGwgcnVubmluZyB0aGUgcHJldmlvdXMgdmVyc2lvbiB3b3VsZCB0aGVuIGZhaWwgdG8gbG9hZFxuICAgICAgICAgICAgLy8gbm9uLXByZWNhY2hlZCBsYXp5IGNodW5rcyAoZS5nLiBtZXJtYWlkKSBhZnRlciBhIGRlcGxveS5cbiAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgaWQgPT09IFwiXFwwdml0ZS9wcmVsb2FkLWhlbHBlci5qc1wiIHx8XG4gICAgICAgICAgICAgIGlkID09PSBcIlxcMGNvbW1vbmpzSGVscGVycy5qc1wiXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgcmV0dXJuIFwiYnVuZGxlci1oZWxwZXJzXCI7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgaWQuaW5jbHVkZXMoXCJwYWNrYWdlcy9leGNhbGlkcmF3L2xvY2FsZXNcIikgJiZcbiAgICAgICAgICAgICAgaWQubWF0Y2goL2VuLmpzb258cGVyY2VudGFnZXMuanNvbi8pID09PSBudWxsXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgY29uc3QgaW5kZXggPSBpZC5pbmRleE9mKFwibG9jYWxlcy9cIik7XG4gICAgICAgICAgICAgIC8vIFRha2luZyB0aGUgc3Vic3RyaW5nIGFmdGVyIFwibG9jYWxlcy9cIlxuICAgICAgICAgICAgICByZXR1cm4gYGxvY2FsZXMvJHtpZC5zdWJzdHJpbmcoaW5kZXggKyA4KX1gO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoXCJAY29kZW1pcnJvci9cIikgfHwgaWQuaW5jbHVkZXMoXCJAbGV6ZXIvXCIpKSB7XG4gICAgICAgICAgICAgIHJldHVybiBcImNvZGVtaXJyb3IuY2h1bmtcIjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICAgIC8vIGRvbid0IGF1dG8taW5saW5lIHNtYWxsIGFzc2V0cyAoaS5lLiBmb250cyBob3N0ZWQgb24gQ0ROKVxuICAgICAgYXNzZXRzSW5saW5lTGltaXQ6IDAsXG4gICAgfSxcbiAgICBwbHVnaW5zOiBbXG4gICAgICBTaXRlbWFwKHtcbiAgICAgICAgaG9zdG5hbWU6IFwiaHR0cHM6Ly9leGNhbGlkcmF3LmNvbVwiLFxuICAgICAgICBvdXREaXI6IFwiYnVpbGRcIixcbiAgICAgICAgZXhjbHVkZTogW1wiLzQwNFwiXSxcbiAgICAgICAgY2hhbmdlZnJlcTogXCJtb250aGx5XCIsXG4gICAgICAgIC8vIGl0cyBzdGF0aWMgaW4gcHVibGljIGZvbGRlclxuICAgICAgICBnZW5lcmF0ZVJvYm90c1R4dDogZmFsc2UsXG4gICAgICB9KSxcbiAgICAgIHdvZmYyQnJvd3NlclBsdWdpbigpLFxuICAgICAgbGF6eUNodW5rc1BsdWdpbihcbiAgICAgICAgL1tcXFxcL11ub2RlX21vZHVsZXNbXFxcXC9dQGV4Y2FsaWRyYXdbXFxcXC9dbWVybWFpZC10by1leGNhbGlkcmF3W1xcXFwvXS8sXG4gICAgICAgIG1lcm1haWRDaHVua0ZpbGVOYW1lcyxcbiAgICAgICAgTUVSTUFJRF9DSFVOS1NfTElTVF9OQU1FLFxuICAgICAgKSxcbiAgICAgIHJlYWN0KCksXG4gICAgICBjaGVja2VyKHtcbiAgICAgICAgdHlwZXNjcmlwdDogdHJ1ZSxcbiAgICAgICAgZXNsaW50OlxuICAgICAgICAgIGVudlZhcnMuVklURV9BUFBfRU5BQkxFX0VTTElOVCA9PT0gXCJmYWxzZVwiXG4gICAgICAgICAgICA/IHVuZGVmaW5lZFxuICAgICAgICAgICAgOiB7IGxpbnRDb21tYW5kOiAnZXNsaW50IFwiLi8qKi8qLntqcyx0cyx0c3h9XCInIH0sXG4gICAgICAgIG92ZXJsYXk6IHtcbiAgICAgICAgICBpbml0aWFsSXNPcGVuOiBlbnZWYXJzLlZJVEVfQVBQX0NPTExBUFNFX09WRVJMQVkgPT09IFwiZmFsc2VcIixcbiAgICAgICAgICBiYWRnZVN0eWxlOiBcIm1hcmdpbi1ib3R0b206IDRyZW07IG1hcmdpbi1sZWZ0OiAxcmVtXCIsXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICAgIHN2Z3JQbHVnaW4oKSxcbiAgICAgIFZpdGVFanNQbHVnaW4oKSxcbiAgICAgIFZpdGVQV0Eoe1xuICAgICAgICByZWdpc3RlclR5cGU6IFwiYXV0b1VwZGF0ZVwiLFxuICAgICAgICBkZXZPcHRpb25zOiB7XG4gICAgICAgICAgLyogc2V0IHRoaXMgZmxhZyB0byB0cnVlIHRvIGVuYWJsZSBpbiBEZXZlbG9wbWVudCBtb2RlICovXG4gICAgICAgICAgZW5hYmxlZDogZW52VmFycy5WSVRFX0FQUF9FTkFCTEVfUFdBID09PSBcInRydWVcIixcbiAgICAgICAgfSxcblxuICAgICAgICB3b3JrYm94OiB7XG4gICAgICAgICAgLy8gU2VydmUgdGhlIGNhY2hlZCBhcHAgc2hlbGwgb25seSBmb3IgdGhlIHBhdGhzIHRoZSBhcHAgbGl2ZXMgb25cbiAgICAgICAgICAvLyAobWF0Y2hlZCBhZ2FpbnN0IHBhdGhuYW1lICsgc2VhcmNoKS4gQW55dGhpbmcgZWxzZSBnb2VzIHRvIHRoZVxuICAgICAgICAgIC8vIG5ldHdvcmssIHNvIHRoYXQgdW5rbm93biBwYXRocyBnZXQgdGhlIHNlcnZlcidzIDQwNC5cbiAgICAgICAgICAvLyBUbyBhZGQgYSBwYXRoLCBhZGQgaXQgdG8gQVBQX1JPVVRFUy5cbiAgICAgICAgICBuYXZpZ2F0ZUZhbGxiYWNrQWxsb3dsaXN0OiBbXG4gICAgICAgICAgICAvXlxcLyhcXD98JCkvLFxuICAgICAgICAgICAgLi4uT2JqZWN0LnZhbHVlcyhBUFBfUk9VVEVTKS5tYXAoXG4gICAgICAgICAgICAgIChyb3V0ZSkgPT4gbmV3IFJlZ0V4cChgXiR7cm91dGV9KFxcXFw/fCQpYCksXG4gICAgICAgICAgICApLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgLy8gZG9uJ3QgcHJlY2FjaGUgZm9udHMsIGxvY2FsZXMgYW5kIHNlcGFyYXRlIGNodW5rc1xuICAgICAgICAgIGdsb2JJZ25vcmVzOiBbXG4gICAgICAgICAgICBcIjQwNC5odG1sXCIsXG4gICAgICAgICAgICBcImZvbnRzLmNzc1wiLFxuICAgICAgICAgICAgXCIqKi9sb2NhbGVzLyoqXCIsXG4gICAgICAgICAgICBcInNlcnZpY2Utd29ya2VyLmpzXCIsXG4gICAgICAgICAgICBcIioqLyouY2h1bmstKi5qc1wiLFxuICAgICAgICAgICAgLy8gQ29kZU1pcnJvckVkaXRvciBjYW4ndCBiZSBhc3NpZ25lZCBhIGAuY2h1bmtgIG5hbWUgdmlhXG4gICAgICAgICAgICAvLyBtYW51YWxDaHVua3MgYmVjYXVzZSBSb2xsdXAgd291bGQgaG9pc3Qgc2hhcmVkIGRlcHMgKFJlYWN0KVxuICAgICAgICAgICAgLy8gdmlhIGEgc3RhdGljIGltcG9ydCBmcm9tIHRoZSBtYWluIGJ1bmRsZSwgZGVmZWF0aW5nIGxhenlcbiAgICAgICAgICAgIC8vIGxvYWRpbmcuIFNvIHdlIGV4Y2x1ZGUgaXQgYnkgbmFtZSBpbnN0ZWFkLlxuICAgICAgICAgICAgXCIqKi9Db2RlTWlycm9yRWRpdG9yLSouanNcIixcbiAgICAgICAgICAgIC8vIGxhenktbG9hZGVkIEZpcmViYXNlIFNESywgb25seSBuZWVkZWQgZm9yIGNvbGxhYi9zaGFyaW5nLCB3aGljaFxuICAgICAgICAgICAgLy8gcmVxdWlyZSBuZXR3b3JrIGFueXdheVxuICAgICAgICAgICAgXCIqKi9maXJlYmFzZVNESy0qLmpzXCIsXG4gICAgICAgICAgXSxcbiAgICAgICAgICAvLyBtZXJtYWlkIGNodW5rcyBhcmUgZXhjbHVkZWQgaGVyZSByYXRoZXIgdGhhbiB2aWEgYGdsb2JJZ25vcmVzYFxuICAgICAgICAgIC8vIGFzIHRoZWlyIGZpbGUgbmFtZXMgYXJlIGFyYml0cmFyeVxuICAgICAgICAgIG1hbmlmZXN0VHJhbnNmb3JtczogW1xuICAgICAgICAgICAgKGVudHJpZXMpID0+ICh7XG4gICAgICAgICAgICAgIG1hbmlmZXN0OiBlbnRyaWVzLmZpbHRlcihcbiAgICAgICAgICAgICAgICAoZW50cnkpID0+ICFtZXJtYWlkQ2h1bmtGaWxlTmFtZXMuaGFzKGVudHJ5LnVybCksXG4gICAgICAgICAgICAgICksXG4gICAgICAgICAgICAgIHdhcm5pbmdzOiBbXSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcnVudGltZUNhY2hpbmc6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdXJsUGF0dGVybjogbmV3IFJlZ0V4cChcIi4rLndvZmYyXCIpLFxuICAgICAgICAgICAgICBoYW5kbGVyOiBcIkNhY2hlRmlyc3RcIixcbiAgICAgICAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgICAgICAgIGNhY2hlTmFtZTogXCJmb250c1wiLFxuICAgICAgICAgICAgICAgIGV4cGlyYXRpb246IHtcbiAgICAgICAgICAgICAgICAgIG1heEVudHJpZXM6IDEwMDAsXG4gICAgICAgICAgICAgICAgICBtYXhBZ2VTZWNvbmRzOiA2MCAqIDYwICogMjQgKiA5MCwgLy8gOTAgZGF5c1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgY2FjaGVhYmxlUmVzcG9uc2U6IHtcbiAgICAgICAgICAgICAgICAgIC8vIDAgdG8gY2FjaGUgXCJvcGFxdWVcIiByZXNwb25zZXMgZnJvbSBjcm9zcy1vcmlnaW4gcmVxdWVzdHMgKGkuZS4gQ0ROKVxuICAgICAgICAgICAgICAgICAgc3RhdHVzZXM6IFswLCAyMDBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB1cmxQYXR0ZXJuOiBuZXcgUmVnRXhwKFwiZm9udHMuY3NzXCIpLFxuICAgICAgICAgICAgICBoYW5kbGVyOiBcIlN0YWxlV2hpbGVSZXZhbGlkYXRlXCIsXG4gICAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICBjYWNoZU5hbWU6IFwiZm9udHNcIixcbiAgICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgICBtYXhFbnRyaWVzOiA1MCxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdXJsUGF0dGVybjogbmV3IFJlZ0V4cChcImxvY2FsZXMvW14vXSsuanNcIiksXG4gICAgICAgICAgICAgIGhhbmRsZXI6IFwiQ2FjaGVGaXJzdFwiLFxuICAgICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgY2FjaGVOYW1lOiBcImxvY2FsZXNcIixcbiAgICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgICBtYXhFbnRyaWVzOiA1MCxcbiAgICAgICAgICAgICAgICAgIG1heEFnZVNlY29uZHM6IDYwICogNjAgKiAyNCAqIDMwLCAvLyA8PT0gMzAgZGF5c1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB1cmxQYXR0ZXJuOiBuZXcgUmVnRXhwKFwiKC5jaHVuay0uK3xDb2RlTWlycm9yRWRpdG9yLS4rKVxcXFwuanNcIiksXG4gICAgICAgICAgICAgIGhhbmRsZXI6IFwiQ2FjaGVGaXJzdFwiLFxuICAgICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgY2FjaGVOYW1lOiBcImNodW5rXCIsXG4gICAgICAgICAgICAgICAgZXhwaXJhdGlvbjoge1xuICAgICAgICAgICAgICAgICAgbWF4RW50cmllczogNTAsXG4gICAgICAgICAgICAgICAgICBtYXhBZ2VTZWNvbmRzOiA2MCAqIDYwICogMjQgKiA5MCwgLy8gPD09IDkwIGRheXNcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdXJsUGF0dGVybjogbmV3IFJlZ0V4cChcIi9hc3NldHMvW14vXStcXFxcLmpzJFwiKSxcbiAgICAgICAgICAgICAgaGFuZGxlcjogXCJDYWNoZUZpcnN0XCIsXG4gICAgICAgICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICBjYWNoZU5hbWU6IFwibGF6eS1jaHVua3NcIixcbiAgICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgICBtYXhFbnRyaWVzOiAyMDAsXG4gICAgICAgICAgICAgICAgICBtYXhBZ2VTZWNvbmRzOiA2MCAqIDYwICogMjQgKiA5MCwgLy8gPD09IDkwIGRheXNcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICAgIG1heGltdW1GaWxlU2l6ZVRvQ2FjaGVJbkJ5dGVzOiAyLjMgKiAxMDI0ICoqIDIsIC8vIDIuM01CXG4gICAgICAgIH0sXG4gICAgICAgIG1hbmlmZXN0OiB7XG4gICAgICAgICAgc2hvcnRfbmFtZTogXCJFeGNhbGlkcmF3XCIsXG4gICAgICAgICAgbmFtZTogXCJFeGNhbGlkcmF3XCIsXG4gICAgICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgICAgICBcIkV4Y2FsaWRyYXcgaXMgYSB3aGl0ZWJvYXJkIHRvb2wgdGhhdCBsZXRzIHlvdSBlYXNpbHkgc2tldGNoIGRpYWdyYW1zIHRoYXQgaGF2ZSBhIGhhbmQtZHJhd24gZmVlbCB0byB0aGVtLlwiLFxuICAgICAgICAgIGljb25zOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHNyYzogXCJhbmRyb2lkLWNocm9tZS0xOTJ4MTkyLnBuZ1wiLFxuICAgICAgICAgICAgICBzaXplczogXCIxOTJ4MTkyXCIsXG4gICAgICAgICAgICAgIHR5cGU6IFwiaW1hZ2UvcG5nXCIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzcmM6IFwiYXBwbGUtdG91Y2gtaWNvbi5wbmdcIixcbiAgICAgICAgICAgICAgdHlwZTogXCJpbWFnZS9wbmdcIixcbiAgICAgICAgICAgICAgc2l6ZXM6IFwiMTgweDE4MFwiLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3JjOiBcImZhdmljb24tMzJ4MzIucG5nXCIsXG4gICAgICAgICAgICAgIHNpemVzOiBcIjMyeDMyXCIsXG4gICAgICAgICAgICAgIHR5cGU6IFwiaW1hZ2UvcG5nXCIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzcmM6IFwiZmF2aWNvbi0xNngxNi5wbmdcIixcbiAgICAgICAgICAgICAgc2l6ZXM6IFwiMTZ4MTZcIixcbiAgICAgICAgICAgICAgdHlwZTogXCJpbWFnZS9wbmdcIixcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICBzdGFydF91cmw6IFwiL1wiLFxuICAgICAgICAgIGlkOiBcImV4Y2FsaWRyYXdcIixcbiAgICAgICAgICBkaXNwbGF5OiBcInN0YW5kYWxvbmVcIixcbiAgICAgICAgICBvcmllbnRhdGlvbjogXCJhbnlcIixcbiAgICAgICAgICBjYXRlZ29yaWVzOiBbXCJwcm9kdWN0aXZpdHlcIiwgXCJncmFwaGljc1wiXSxcbiAgICAgICAgICB0aGVtZV9jb2xvcjogXCIjMTIxMjEyXCIsXG4gICAgICAgICAgYmFja2dyb3VuZF9jb2xvcjogXCIjZmZmZmZmXCIsXG4gICAgICAgICAgZmlsZV9oYW5kbGVyczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBhY3Rpb246IFwiL1wiLFxuICAgICAgICAgICAgICBhY2NlcHQ6IHtcbiAgICAgICAgICAgICAgICBcImFwcGxpY2F0aW9uL3ZuZC5leGNhbGlkcmF3K2pzb25cIjogW1wiLmV4Y2FsaWRyYXdcIl0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgc2NyZWVuc2hvdHM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3JjOiBcIi9zY3JlZW5zaG90cy92aXJ0dWFsLXdoaXRlYm9hcmQucG5nXCIsXG4gICAgICAgICAgICAgIHR5cGU6IFwiaW1hZ2UvcG5nXCIsXG4gICAgICAgICAgICAgIHNpemVzOiBcIjQ2Mng5NDVcIixcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHNyYzogXCIvc2NyZWVuc2hvdHMvd2lyZWZyYW1lLnBuZ1wiLFxuICAgICAgICAgICAgICB0eXBlOiBcImltYWdlL3BuZ1wiLFxuICAgICAgICAgICAgICBzaXplczogXCI0NjJ4OTQ1XCIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzcmM6IFwiL3NjcmVlbnNob3RzL2lsbHVzdHJhdGlvbi5wbmdcIixcbiAgICAgICAgICAgICAgdHlwZTogXCJpbWFnZS9wbmdcIixcbiAgICAgICAgICAgICAgc2l6ZXM6IFwiNDYyeDk0NVwiLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3JjOiBcIi9zY3JlZW5zaG90cy9zaGFwZXMucG5nXCIsXG4gICAgICAgICAgICAgIHR5cGU6IFwiaW1hZ2UvcG5nXCIsXG4gICAgICAgICAgICAgIHNpemVzOiBcIjQ2Mng5NDVcIixcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHNyYzogXCIvc2NyZWVuc2hvdHMvY29sbGFib3JhdGlvbi5wbmdcIixcbiAgICAgICAgICAgICAgdHlwZTogXCJpbWFnZS9wbmdcIixcbiAgICAgICAgICAgICAgc2l6ZXM6IFwiNDYyeDk0NVwiLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3JjOiBcIi9zY3JlZW5zaG90cy9leHBvcnQucG5nXCIsXG4gICAgICAgICAgICAgIHR5cGU6IFwiaW1hZ2UvcG5nXCIsXG4gICAgICAgICAgICAgIHNpemVzOiBcIjQ2Mng5NDVcIixcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgICAgY3JlYXRlSHRtbFBsdWdpbih7XG4gICAgICAgIG1pbmlmeTogdHJ1ZSxcbiAgICAgIH0pLFxuICAgIF0sXG4gICAgcHVibGljRGlyOiBcIi4uL3B1YmxpY1wiLFxuICB9O1xufSk7XG4iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXE1hbmFuXFxcXERlc2t0b3BcXFxccHJvamVjdFxcXFxleGNhbGlkcmF3XFxcXGV4Y2FsaWRyYXctYXBwXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxNYW5hblxcXFxEZXNrdG9wXFxcXHByb2plY3RcXFxcZXhjYWxpZHJhd1xcXFxleGNhbGlkcmF3LWFwcFxcXFxhcHBfcm91dGVzLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy9NYW5hbi9EZXNrdG9wL3Byb2plY3QvZXhjYWxpZHJhdy9leGNhbGlkcmF3LWFwcC9hcHBfcm91dGVzLnRzXCI7LyoqXG4gKiBQYXRocywgYmVzaWRlcyBgL2AsIHRoYXQgdGhlIGFwcCBpcyBzZXJ2ZWQgb24uXG4gKlxuICogQWRkaW5nIGEgcGF0aCBoZXJlIGxldHMgdGhlIHNlcnZpY2Ugd29ya2VyIHNlcnZlIHRoZSBjYWNoZWQgYXBwIGZvciBpdFxuICogKHNlZSBgbmF2aWdhdGVGYWxsYmFja0FsbG93bGlzdGAgaW4gdml0ZS5jb25maWcubXRzKS4gVGhlIGhvc3QgbXVzdCBzZXJ2ZVxuICogdGhlIGFwcCBmb3IgaXQgdG9vLCBvciB0aGUgcGF0aCBpcyBhIDQwNDogYWRkIGEgbWF0Y2hpbmcgcmV3cml0ZSB0b1xuICogYC9pbmRleC5odG1sYCBpbiB0aGUgcm9vdCB2ZXJjZWwuanNvbiAodGVzdHMvYXBwUm91dGVzLnRlc3QudHMgY2hlY2tzIGl0KS5cbiAqL1xuZXhwb3J0IGNvbnN0IEFQUF9ST1VURVMgPSB7XG4gIGV4Y2FsaWRyYXdQbHVzRXhwb3J0OiBcIi9leGNhbGlkcmF3LXBsdXMtZXhwb3J0XCIsXG4gIC8qKiBTaWduIGluIC8gc2lnbiB1cCBmb3IgdGhlIFBsdXMgc2VydmVyIChgZXhjYWxpZHJhdy1hcHAvcGx1c2ApLiAqL1xuICBzaWduSW46IFwiL3NpZ25pblwiLFxuICAvKiogU2NlbmVzLCBjb2xsZWN0aW9ucyBhbmQgdGVhbXMgb2YgdGhlIFBsdXMgc2VydmVyIChgZXhjYWxpZHJhdy1hcHAvcGx1cy9kYXNoYm9hcmRgKS4gKi9cbiAgZGFzaGJvYXJkOiBcIi9kYXNoYm9hcmRcIixcbn0gYXMgY29uc3Q7XG4iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXE1hbmFuXFxcXERlc2t0b3BcXFxccHJvamVjdFxcXFxleGNhbGlkcmF3XFxcXGV4Y2FsaWRyYXctYXBwXFxcXGRhdGFcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXE1hbmFuXFxcXERlc2t0b3BcXFxccHJvamVjdFxcXFxleGNhbGlkcmF3XFxcXGV4Y2FsaWRyYXctYXBwXFxcXGRhdGFcXFxcY2FjaGVNZXJtYWlkQ2h1bmtzLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy9NYW5hbi9EZXNrdG9wL3Byb2plY3QvZXhjYWxpZHJhdy9leGNhbGlkcmF3LWFwcC9kYXRhL2NhY2hlTWVybWFpZENodW5rcy50c1wiOy8qKlxuICogVGhlIG5hbWUgb2YgdGhlIGA8bWV0YT5gIHRoYXQgcG9pbnRzIHRvIHRoZSBKU09OIGxpc3Qgb2YgdGhlIG1lcm1haWQgY2h1bmtzLFxuICogd2hpY2ggYGxhenlDaHVua3NQbHVnaW5gICh2aXRlLmNvbmZpZy5tdHMpIGVtaXRzIGluIHByb2R1Y3Rpb24gYnVpbGRzLlxuICovXG5leHBvcnQgY29uc3QgTUVSTUFJRF9DSFVOS1NfTElTVF9OQU1FID0gXCJtZXJtYWlkLWNodW5rc1wiO1xuXG4vLyBMZXRzIHRoZSBkaWFsb2cgbG9hZCB0aGUgY2h1bmtzIGl0IG5lZWRzIGZpcnN0IChtZXJtYWlkLXRvLWV4Y2FsaWRyYXcsIGFuZFxuLy8gdGhvc2Ugb2YgdGhlIGRpYWdyYW0gdHlwZSBpdCBjb252ZXJ0cyksIHNvIHRoYXQgdGhleSBhcmVuJ3QgZmV0Y2hlZCB0d2ljZTpcbi8vIGNhY2hlZCBjaHVua3MgYXJlIHRoZW4gc2VydmVkIGZyb20gdGhlIGNhY2hlLlxuY29uc3QgQ0FDSEVfREVMQVlfTVMgPSA1MDAwO1xuXG5sZXQgY2FjaGluZzogUHJvbWlzZTx1bmtub3duPiB8IG51bGwgPSBudWxsO1xuXG4vKipcbiAqIFRoZSBtZXJtYWlkIGNodW5rcyAobWVybWFpZC10by1leGNhbGlkcmF3LCBhbmQgUGVsZSdzIGNodW5rIHBlciBkaWFncmFtXG4gKiB0eXBlKSBhcmVuJ3QgcHJlY2FjaGVkLCBhcyBtb3N0IHVzZXJzIG5ldmVyIHVzZSBNZXJtYWlkLiBPbmNlIHRoZSBUVEQgZGlhbG9nXG4gKiBpcyBvcGVuZWQsIHRoZXkncmUgYWxsIGZldGNoZWQgZm9yIHRoZSBzZXJ2aWNlIHdvcmtlciB0byBjYWNoZSAoYGxhenktY2h1bmtzYFxuICogcnVudGltZSBjYWNoaW5nKSwgc28gdGhhdCBvZmZsaW5lLCBldmVyeSBkaWFncmFtIHR5cGUgY29udmVydHMsIG5vdCBqdXN0IHRoZVxuICogb25lcyB1c2VkIHdoaWxlIG9ubGluZS5cbiAqL1xuZXhwb3J0IGNvbnN0IGNhY2hlTWVybWFpZENodW5rcyA9ICgpID0+IHtcbiAgY29uc3QgbGlzdEZpbGVOYW1lID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcjxIVE1MTWV0YUVsZW1lbnQ+KFxuICAgIGBtZXRhW25hbWU9XCIke01FUk1BSURfQ0hVTktTX0xJU1RfTkFNRX1cIl1gLFxuICApPy5jb250ZW50O1xuICBpZiAoY2FjaGluZyB8fCAhbGlzdEZpbGVOYW1lIHx8ICFuYXZpZ2F0b3Iuc2VydmljZVdvcmtlcj8uY29udHJvbGxlcikge1xuICAgIHJldHVybjtcbiAgfVxuICBjYWNoaW5nID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgQ0FDSEVfREVMQVlfTVMpKVxuICAgIC50aGVuKCgpID0+IGZldGNoKGAke2ltcG9ydC5tZXRhLmVudi5CQVNFX1VSTH0ke2xpc3RGaWxlTmFtZX1gKSlcbiAgICAudGhlbigocmVzcG9uc2UpID0+IHJlc3BvbnNlLmpzb24oKSlcbiAgICAudGhlbigoZmlsZU5hbWVzOiBzdHJpbmdbXSkgPT5cbiAgICAgIFByb21pc2UuYWxsKFxuICAgICAgICBmaWxlTmFtZXMubWFwKChmaWxlTmFtZSkgPT5cbiAgICAgICAgICBmZXRjaChgJHtpbXBvcnQubWV0YS5lbnYuQkFTRV9VUkx9JHtmaWxlTmFtZX1gLCB7IHByaW9yaXR5OiBcImxvd1wiIH0pLFxuICAgICAgICApLFxuICAgICAgKSxcbiAgICApXG4gICAgLmNhdGNoKCgpID0+IHtcbiAgICAgIC8vIGUuZy4gb2ZmbGluZSAtPiByZXRyeSBvbmNlIHRoZSBkaWFsb2cgaXMgb3BlbmVkIGFnYWluXG4gICAgICBjYWNoaW5nID0gbnVsbDtcbiAgICB9KTtcbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFDQSxRQUFNLGdCQUFnQjtBQUN0QixRQUFNLHFCQUFxQjtBQU8zQixXQUFPLFFBQVEscUJBQXFCLE1BQU07QUFDeEMsVUFBSTtBQUVKLGFBQU87QUFBQSxRQUNMLE1BQU07QUFBQSxRQUNOLFNBQVM7QUFBQSxRQUNULE9BQU8sR0FBRyxFQUFFLFFBQVEsR0FBRztBQUNyQixrQkFBUSxZQUFZO0FBQUEsUUFDdEI7QUFBQSxRQUNBLFVBQVUsTUFBTSxJQUFJO0FBR2xCLGNBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyw2QkFBNkIsR0FBRztBQUN4RCxtQkFBTztBQUFBO0FBQUE7QUFBQTtBQUFBLG1CQUlJLGFBQWE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxtQkFVYixhQUFhO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7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
