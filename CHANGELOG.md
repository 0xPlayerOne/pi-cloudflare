# Changelog

## [0.5.0](https://github.com/0xPlayerOne/pi-cloudflare/compare/pi-cloudflare-v0.4.1...pi-cloudflare-v0.5.0) (2026-09-07)


### Features

* migrate formatting and linting from Prettier/ESLint to oxfmt/oxlint ([#17](https://github.com/0xPlayerOne/pi-cloudflare/issues/17)) ([751c9a5](https://github.com/0xPlayerOne/pi-cloudflare/commit/751c9a57a2cd1f96c82fc9af2c6b58f47c997803))

## [0.4.1](https://github.com/0xPlayerOne/pi-cloudflare/compare/pi-cloudflare-v0.4.0...pi-cloudflare-v0.4.1) (2026-09-06)


### Maintenance

* adopt code-foundry v1.1.1 baseline ([#14](https://github.com/0xPlayerOne/pi-cloudflare/issues/14)) ([84297b0](https://github.com/0xPlayerOne/pi-cloudflare/commit/84297b00fe4dec0769a5d0f694d7c209a3c69a50))

## [0.4.0](https://github.com/0xPlayerOne/pi-cloudflare/compare/pi-cloudflare-v0.3.1...pi-cloudflare-v0.4.0) (2026-09-06)


### Features

* api-token lifecycle skills (create, roll, scopes) + validation findings ([#12](https://github.com/0xPlayerOne/pi-cloudflare/issues/12)) ([2c7b241](https://github.com/0xPlayerOne/pi-cloudflare/commit/2c7b24150777dcea667184bd6b5f26d1d069b0f0))
* exact API token recipe with verifier script ([9b5bd9e](https://github.com/0xPlayerOne/pi-cloudflare/commit/9b5bd9e9b7c5017f1d5c7ac2beb002eb9249a036))


### Documentation

* wrangler CLI vs MCP routing table ([8101016](https://github.com/0xPlayerOne/pi-cloudflare/commit/8101016b1db9d07639f1a0dea9a697b34e30caed))

## [0.3.1](https://github.com/0xPlayerOne/pi-cloudflare/compare/pi-cloudflare-v0.3.0...pi-cloudflare-v0.3.1) (2026-09-06)


### Bug Fixes

* **auth:** drop unproven offline_access scope support ([3ce0210](https://github.com/0xPlayerOne/pi-cloudflare/commit/3ce0210fc6c8020e3ba0b4a2d33ffddb6bec2ee2))

## [0.3.0](https://github.com/0xPlayerOne/pi-cloudflare/compare/pi-cloudflare-v0.2.4...pi-cloudflare-v0.3.0) (2026-09-06)


### Features

* durable auth via static API token plus graceful re-auth recovery ([357109c](https://github.com/0xPlayerOne/pi-cloudflare/commit/357109cbac8c75fe006b71e55b72ee742ebce32b))
* durable auth via static API token plus graceful re-auth recovery ([9b1da66](https://github.com/0xPlayerOne/pi-cloudflare/commit/9b1da6627b16204833d347b52f67f511432574c4))

## [0.2.4](https://github.com/0xPlayerOne/pi-cloudflare/compare/pi-cloudflare-v0.2.3...pi-cloudflare-v0.2.4) (2026-09-06)


### Maintenance

* **sync:** adopt code-foundry v1.0.4 baseline ([9141c36](https://github.com/0xPlayerOne/pi-cloudflare/commit/9141c36eb205d92a43aad7dc2725980366d9cbdf))

## [0.2.3](https://github.com/0xPlayerOne/pi-cloudflare/compare/pi-cloudflare-v0.2.2...pi-cloudflare-v0.2.3) (2026-09-06)


### Maintenance

* **sync:** adopt code-foundry v1.0.3 baseline ([1d9c55d](https://github.com/0xPlayerOne/pi-cloudflare/commit/1d9c55d37e4763c22d3864ab79478790f1134fea))

## [0.2.2](https://github.com/0xPlayerOne/pi-cloudflare/compare/pi-cloudflare-v0.2.1...pi-cloudflare-v0.2.2) (2026-09-06)


### Documentation

* architecture diagram and troubleshooting ([f504a88](https://github.com/0xPlayerOne/pi-cloudflare/commit/f504a88280ce1090dc354666b195dd6776de8f4e))

## [0.2.1](https://github.com/0xPlayerOne/pi-cloudflare/compare/pi-cloudflare-v0.2.0...pi-cloudflare-v0.2.1) (2026-09-06)


### Maintenance

* **sync:** adopt code-foundry v1.0.2 baseline ([29c2805](https://github.com/0xPlayerOne/pi-cloudflare/commit/29c280517af489881da729ad14a5ca24b92ed849))

## [0.2.0](https://github.com/0xPlayerOne/pi-cloudflare/compare/pi-cloudflare-v0.1.0...pi-cloudflare-v0.2.0) (2026-09-05)


### Features

* Cloudflare MCP extension with vendored skills and OAuth setup ([3ef754c](https://github.com/0xPlayerOne/pi-cloudflare/commit/3ef754cf40b3b9e89beb18dd3089f51f05679fed))


### Bug Fixes

* **ci:** drop pip updates for JS-only package; hold TS toolchain below v7 ([25a6172](https://github.com/0xPlayerOne/pi-cloudflare/commit/25a6172cef4a77ae0affaed16cef118987a5d782))
* **ci:** use packages manifest shape so releases resolve their baseline ([8415dd2](https://github.com/0xPlayerOne/pi-cloudflare/commit/8415dd264306615921513f1bda50ec6d49c34583))
* document web-perf exclusion in install notes ([38e3d53](https://github.com/0xPlayerOne/pi-cloudflare/commit/38e3d530d01c001c92a6e4aafdb3c110caad09d7))
* MIT license throughout; repo-owned format gate; pin TS toolchain ([8dd9b5b](https://github.com/0xPlayerOne/pi-cloudflare/commit/8dd9b5b84d55503a43e5f13ee52ede9305cabb6d))


### Documentation

* published reality, npx setup form, no-dup install notes ([e87949d](https://github.com/0xPlayerOne/pi-cloudflare/commit/e87949da5de2a1223129c91e61ae3c257679cff3))


### Maintenance

* **ci:** adopt code-foundry v0.40.2 runtime and ignore overlaid actions ([ee7a31c](https://github.com/0xPlayerOne/pi-cloudflare/commit/ee7a31c9a9698c02a1046f5515f78efc1ae46814))
* **ci:** align prettierignore with runtime template ([4bfb871](https://github.com/0xPlayerOne/pi-cloudflare/commit/4bfb8717f5b036037619d6bf7392ddf55eab5ce5))
* **ci:** preserve authored MIT license on sync ([0ef13fd](https://github.com/0xPlayerOne/pi-cloudflare/commit/0ef13fd16774f56bb0d7333263f6146caa4472d6))
* **ci:** publish releases to npm ([55f99bb](https://github.com/0xPlayerOne/pi-cloudflare/commit/55f99bb0166cb1b1b59452ea4ef0687c398d34a6))
* **main:** release 0.1.1 ([ca08963](https://github.com/0xPlayerOne/pi-cloudflare/commit/ca08963224198a2e71e043df2a7d65b3e67ccf51))
* **sync:** adopt code-foundry v0.40.3 baseline ([36cc8c8](https://github.com/0xPlayerOne/pi-cloudflare/commit/36cc8c8f90a6804148585bd09107726afc9b1c68))
* **sync:** adopt code-foundry v1.0.0 baseline ([e596706](https://github.com/0xPlayerOne/pi-cloudflare/commit/e596706ea437d2f50c1485358e1fcf2bc7f9a826))
* **sync:** adopt code-foundry v1.0.1 baseline ([dce1e0e](https://github.com/0xPlayerOne/pi-cloudflare/commit/dce1e0e07640e201f91de7919736e1f4ab77c035))
