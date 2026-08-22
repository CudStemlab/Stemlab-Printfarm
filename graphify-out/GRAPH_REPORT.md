# Graph Report - 3D-FarmLab  (2026-08-22)

## Corpus Check
- 313 files · ~348,114 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3705 nodes · 9568 edges · 282 communities (159 shown, 123 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 944 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e386c4be`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- sidebar.tsx
- dependencies
- app.js
- postgres.js
- MEDIUM
- maintenance.go
- StatusLightFlashDialog.tsx
- testing.T
- cameraStream
- bambuCamera.js
- server.js
- updateRollback.js
- slicer-proxy/index.js
- PrinterDetail.tsx
- FilamentStation.tsx
- settingsApi.ts
- handleLogin
- sendJson
- run
- NetworkUsage.tsx
- backupArchive.test.mjs
- dataapi.go
- oauthApi.ts
- homeassistant.go
- isRedisEnabled
- run
- AuthContext.tsx
- CameraStream
- net/http.ResponseWriter
- Maintenance.tsx
- context.Context
- 3D-FarmLab
- BottomTabBar.tsx
- printerConn
- net/http.Request
- mStr
- routes.tsx
- handleAPI
- SoftwareUpdateSettings.tsx
- Admin credential resource
- queue.go
- Any
- modelViewer.ts
- mMap
- saml.go
- vite.config.js
- docker-compose.yml — full stack definition
- hover-card.tsx
- sanitizePrinterTelemetry
- bambu.go
- PrinterCardLayout.tsx
- DeviceConfig
- entrypoint.sh
- Monitoring — Prometheus
- Dashboard.tsx
- BackupSettings.tsx
- branding.go
- NFCService
- parse3mf.js
- FilamentStationAPI
- send_discord_embed
- xlsxExport.ts
- bambuhms.go
- matchOrCreateFilamentSpools
- publicViewerApi.ts
- authSessionApi.ts
- PrintFarmCollector
- rbac.js
- bambu_error_message
- helpers.go
- command.go
- SetupView
- 3D-FarmLab — API Reference
- Hardware control proxy (/printers/:id/proxy/<path>)
- HomeAssistantSettings.tsx
- printEstimate.js
- Connection
- _BambuMqttClient
- Resources
- Writer
- menubar.tsx
- FilamentSpool
- Grafana dashboard provisioning config
- form.tsx
- public/icons.svg (icon sprite sheet)
- Settings.tsx
- PrintFarm — Security Architecture & Hardening Plan
- 🚀 Quick Start
- App.tsx
- detectBambuAssignmentTriggers
- SSO configuration (/api/settings/saml)
- cn
- MCP server (`mcp` service)
- filamentStation.js
- notify.go
- public/icon.svg (PrintFarm App Icon)
- public/icon-maskable.svg
- Alert response
- statusLightBroker.js
- printfarm
- icon-192.png (App Icon)
- App Icon (512x512, 3D Printer Glyph)
- handleDataApiSlicerKeys
- metrics.js
- _fetch_bambu_3mf
- bambumerge.go
- Endpoints
- handleRequest
- adminCredentialApi.ts
- Security Policy
- Cipher
- Agent Notes
- 2.2 Component threat tables
- Endpoints
- CLAUDE.md
- printEstimate.test.mjs
- Frontend session API (`/api/auth/*`)
- notify_for_transition
- Home Assistant (`/api/settings/home-assistant`)
- publish_live_telemetry
- parse3mfFilamentSlots
- queueEstimateBackfill.js
- certpin.go
- oauthGrant.js
- Google Sheet queue sync (legacy, superseded)
- Analytics resource (/api/v1/analytics)
- API.md — API Reference
- Audit logs resource
- Frontend session API (/api/auth/*)
- Home Assistant integration endpoints
- Maintenance resource (/api/v1/maintenance)
- Manager Access Request API (/api/manager)
- Manager access requests (/api/v1/manager-requests)
- Notifications resource (Discord webhook CRUD)
- Sign-in settings (/api/settings/oauth/:provider)
- Printers resource (/api/v1/printers)
- Website access mode (/api/settings/public-viewer)
- Queue migration routes (export/import, host→host)
- Queue resource (/api/v1/queue)
- Settings resource (app_settings key/value)
- Slicer API keys resource
- SSO public URL setting (/api/settings/sso-public-url)
- SSO sign-in API (/api/auth)
- Staff users resource
- Webcam endpoints (/api/v1 camera snapshot/stream/health)
- programmatic /api/v1 data API
- Bambu filament usage tracking
- database schema & migrations framework
- health, readiness & logging (/healthz, /readyz)
- metrics/monitoring subsystem (printfarm_* namespace)
- numeric formatting rule (≤2 decimal places)
- in-app print-request form (/request)
- printer polling mechanism (Bambu MQTT/FTPS, Snapmaker Moonraker)
- security headers & CSRF protection
- slicer upload / OctoPrint emulation
- public viewer mode
- /api/v1 data API Go port
- Camera hub Go port (ffmpeg RTSP→MJPEG)
- Phase 11 cutover to Dockerfile.go
- jsCompact JSON re-serialization parity mechanism
- SAML SSO Go port (goxmldsig)
- go-services/WEB_PORT_PLAN.md — Go web port roadmap
- monitoring/RUNBOOK.md — Operations Runbook
- README.md — project overview
- C-1 Unauthenticated Access to Printer Control Proxy
- C-2 Login Rate Limiter Bypassed via X-Forwarded-For Spoofing
- C-3 No Rate Limiting on credential verify endpoints
- C-4 Slicer Upload Has No File Size Limit
- H-1 Prometheus UI Exposed on Public Site Without Authentication
- H-2 TLS Certificate Verification Disabled for Bambu Connections
- H-3 SSRF via SAML Test Endpoint
- H-4 In-Memory Login Rate Limiting Not Shared Across Go Web Replicas
- H-5 Slicer Upload Filename Not Sanitized Before FTP Write
- H-6 SAML Auto-Provisioned Users Can Receive IdP-Asserted Admin Role
- L-1 Redis Has No Password
- L-2 CI/CD Only Tags :latest — No Rollback Capability
- L-3 Printer URL/IP Not Validated to Private Address Space
- L-4 No Audit Log on Failed Credential Verify Calls
- L-5 No Security Headers on Slicer Proxy Responses
- L-6 Sessions Not Bound to IP or User-Agent
- L-7 MQTT Client ID Embeds Printer Serial and Nanosecond Timestamp
- M-1 OAuth JWT Claims Not Signature-Verified
- M-2 Public Queue Submit and Manager Request Not Rate-Limited
- M-3 Webcam HTML from Printer Served on Dashboard Origin
- M-4 User-Controlled X-Request-Id Reflected in Response Header
- M-5 Admin Credential First-Run Endpoint Permanently Public
- M-6 SVG Sanitizer Uses Regex — Multiple Bypass Vectors
- M-7 Internal Error Details Forwarded to Clients
- SECURITY_AUDIT.md — Security Audit Report
- Vulnerability reporting policy
- tenantContext.test.mjs
- security-smoke.sh
- usersApi.ts
- Config
- Operational endpoints
- SpoolListView
- web/metrics.go
- printer_status_poller.py
- Client
- 11. Refactoring Plan
- threemf.go
- package.json
- jsWriteValue
- .RoundTrip
- time.Duration
- toggle-group.tsx
- Print-Farm Status Light (ESP32-C3 Super Mini)
- Go web/api port — roadmap
- APIError
- devDependencies
- slicerGrant.js
- WriteTagView
- 1. Security Assessment
- Multi-tenant isolation (S-2 phase 2)
- Filament Station — iOS (Core NFC)
- 5. Authentication Flow
- 6. Authorization Model
- Appendix A — OWASP mapping
- resolveSlotToTray
- refreshStatus
- 10-prometheus-htpasswd.sh
- ensureBambuSlicerEstimate
- 15-mcp-access.sh
- class-variance-authority
- clsx
- date-fns
- @dnd-kit/core
- @dnd-kit/utilities
- ioredis
- lucide-react
- next-themes
- esptool-js
- pg
- @radix-ui/react-accordion
- @radix-ui/react-alert-dialog
- @radix-ui/react-aspect-ratio
- @radix-ui/react-avatar
- @radix-ui/react-checkbox
- @radix-ui/react-collapsible
- @radix-ui/react-context-menu
- @radix-ui/react-dialog
- @radix-ui/react-dropdown-menu
- @radix-ui/react-hover-card
- @radix-ui/react-menubar
- @radix-ui/react-navigation-menu
- @radix-ui/react-radio-group
- @radix-ui/react-scroll-area
- @radix-ui/react-select
- @radix-ui/react-separator
- @radix-ui/react-slot
- @radix-ui/react-toggle
- @radix-ui/react-tooltip
- react-dom
- react-grid-layout
- react-hook-form
- react-router
- recharts
- sonner
- tailwind-merge
- three
- tw-animate-css
- ws
- xml-crypto
- @xmldom/xmldom
- xpath
- zod
- uploadToBambu
- AuthProvider
- fetchLatestPublishedVersion
- secretCrypto.js
- busboy

## God Nodes (most connected - your core abstractions)
1. `cn()` - 200 edges
2. `handleApi()` - 150 edges
3. `query()` - 111 edges
4. `ensureSchema()` - 101 edges
5. `logAuditEvent()` - 58 edges
6. `mStr()` - 56 edges
7. `sendJSON()` - 53 edges
8. `internalError()` - 52 edges
9. `PrinterDetail()` - 52 edges
10. `handleAPI()` - 40 edges

## Surprising Connections (you probably didn't know these)
- `Watchtower sidecar (one-click update)` --shares_data_with--> `CI: Build and Push Images workflow`  [INFERRED]
  docker-compose.deploy.yml → .github/workflows/deploy.yml
- `openBambuFTP()` --calls--> `addrPort()`  [INFERRED]
  go-services/cmd/poller/bambuftp.go → go-services/cmd/poller/util.go
- `run()` --calls--> `resetCycleBytes()`  [INFERRED]
  go-services/cmd/poller/run.go → go-services/cmd/poller/netbytes.go
- `run()` --calls--> `snapshotCycleBytes()`  [INFERRED]
  go-services/cmd/poller/run.go → go-services/cmd/poller/netbytes.go
- `handleAPI()` --calls--> `buildID()`  [INFERRED]
  go-services/cmd/web/api.go → go-services/cmd/web/manager.go

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Exporter to Prometheus to Grafana metrics pipeline** — claude_exporter_service, monitoring_prometheus_prometheus_scrape_config, monitoring_grafana_provisioning_datasources_prometheus_datasource_provisioning [EXTRACTED 1.00]
- **Seven-plus service Docker Compose stack** — docker_compose_compose_stack, claude_web_service, claude_db_service, claude_poller_service, claude_nginx_service, claude_exporter_service, claude_prometheus_service, claude_slicer_proxy_service, claude_redis_service [EXTRACTED 1.00]
- **Critical-severity security audit findings** — security_audit_c1_unauth_printer_proxy, security_audit_c2_rate_limiter_bypass, security_audit_c3_no_rate_limit_verify, security_audit_c4_slicer_upload_no_size_limit [INFERRED 0.85]

## Communities (282 total, 123 thin omitted)

### Community 0 - "sidebar.tsx"
Cohesion: 0.07
Nodes (33): Separator(), Sidebar(), SidebarContent(), SidebarContext, SidebarContextProps, SidebarFooter(), SidebarGroup(), SidebarGroupAction() (+25 more)

### Community 1 - "dependencies"
Cohesion: 0.08
Nodes (25): aedes, basic-ftp, @dnd-kit/sortable, @modelcontextprotocol/sdk, mqtt, dependencies, aedes, basic-ftp (+17 more)

### Community 2 - "app.js"
Cohesion: 0.02
Nodes (154): analyzeSvgForTheme(), APP_VERSION, assertPublicHttpTarget(), authenticateDataApi(), authorizeFrontendApi(), BACKUP_UPLOAD_MAX_BYTES, BAMBU_PROFILES, broadcastMaintenanceStatusUpdate() (+146 more)

### Community 3 - "postgres.js"
Cohesion: 0.05
Nodes (112): createAndBroadcastMaintenanceNotification(), runMaintenanceWorkerPass(), addPrintHours(), approveManagerRequest(), backfillAllMaintenanceSchedules(), BACKUP_FORMAT_VERSION, BACKUP_TABLES, buildPrinterListSelect() (+104 more)

### Community 4 - "MEDIUM"
Cohesion: 0.06
Nodes (32): C-1 — Unauthenticated Access to Printer Control Proxy, C-2 — Login Rate Limiter Bypassed via X-Forwarded-For Spoofing, C-3 — No Rate Limiting on `/api/admin/credential/verify` and `/api/users/verify`, C-4 — Slicer Upload Has No File Size Limit, CRITICAL (must fix before production), H-1 — Prometheus UI Exposed on Public Site Without Authentication, H-2 — TLS Certificate Verification Disabled for All Bambu Printer Connections, H-3 — SSRF via SAML Test Endpoint (Admin-Reachable) (+24 more)

### Community 5 - "maintenance.go"
Cohesion: 0.13
Nodes (30): completeMaintenanceEvent(), getMaintenanceDefaultIntervals(), getMaintenanceSummary(), getPrinterMaintenance(), healthStatusFromScore(), isNozzleResetType(), isOverdue(), jsISO() (+22 more)

### Community 6 - "StatusLightFlashDialog.tsx"
Cohesion: 0.05
Nodes (73): KeycloakSsoSettingsProps, ACCEPTED_EXTENSIONS, FileEntry, PrintRequestDialogProps, DAY_LABELS, DEFAULT_SETTINGS, QueueAvailabilityDialogProps, Phase (+65 more)

### Community 7 - "testing.T"
Cohesion: 0.27
Nodes (26): DefaultConfig(), FromModel(), asciiSTLCube(), binarySTLCube(), buildZip(), cubeTriangles(), expectedCube(), meshThreeMF() (+18 more)

### Community 8 - "cameraStream"
Cohesion: 0.11
Nodes (19): buildRtspURL(), ensureSupervisor(), exitCodeOf(), ffmpegArgs(), getAllCameraHealth(), getStream(), lastLine(), lastN() (+11 more)

### Community 9 - "bambuCamera.js"
Cohesion: 0.24
Nodes (10): BAMBU_RTSP_PROFILES, captureBambuSnapshot(), handleBambuWebcam(), addCameraViewer(), ensureSupervisor(), getAllCameraHealth(), getCameraHealth(), getCameraSnapshot() (+2 more)

### Community 10 - "server.js"
Cohesion: 0.11
Nodes (35): classifyAdminRequest(), RESTRICTED_WRITE_RESOURCES, createApiClient(), request(), errorFrom(), toError(), createMcpHttpHandler(), handler() (+27 more)

### Community 11 - "updateRollback.js"
Cohesion: 0.33
Nodes (7): githubFetch(), githubHeaders(), isValidSha(), normalizeSha(), pollRollbackWorkflow(), HOSTILE, triggerRollbackWorkflow()

### Community 12 - "slicer-proxy/index.js"
Cohesion: 0.12
Nodes (33): buildFilamentManagerSelections(), buildFilamentManagerSpools(), buildSpoolManagerSpools(), FILAMENT_PLUGIN_SETTINGS, normalizeSpools(), spoolDisplayName(), appBaseUrl, audit() (+25 more)

### Community 13 - "PrinterDetail.tsx"
Cohesion: 0.06
Nodes (80): logAuditEvent(), CameraHealth, fetchCameraHealth(), BAMBU_CALIBRATIONS, BAMBU_SETUP_STEPS, buildCurrentJob(), buildJogGcode(), buildPrinterWebcamMjpegUrl() (+72 more)

### Community 14 - "FilamentStation.tsx"
Cohesion: 0.08
Nodes (46): FilamentSpoolIcon(), Tabs(), TabsContent(), TabsList(), TabsTrigger(), assignFilamentSpool(), AssignSpoolInput, createFilamentSpool() (+38 more)

### Community 15 - "settingsApi.ts"
Cohesion: 0.18
Nodes (16): QueueAvailabilityDialog(), BrandingInput, BrandingSettings, DEFAULT_BRANDING_SETTINGS, DEFAULT_INTEGRATION_SETTINGS, fetchIntegrationSettings(), fetchQueueAvailabilitySettings(), IntegrationSettings (+8 more)

### Community 16 - "handleLogin"
Cohesion: 0.11
Nodes (36): getClientIP(), adminStoredHash(), checkLoginRate(), clearLoginAttempts(), clientIPString(), findUserByCredential(), handleAdminCredential(), handleAdminCredentialVerify() (+28 more)

### Community 17 - "sendJson"
Cohesion: 0.12
Nodes (45): auditDataApi(), dataApiMethodNotAllowed(), derivePasswordHash(), findUserByCredential(), handleDataApi(), handleDataApiAdminCredential(), handleDataApiAnalytics(), handleDataApiAuditLogs() (+37 more)

### Community 18 - "run"
Cohesion: 0.11
Nodes (37): applyFilamentConsumption(), pgx.Conn, pmap, main(), accumulateTotalPrintTime(), pmap, persistSignature(), pruneTracking() (+29 more)

### Community 19 - "NetworkUsage.tsx"
Cohesion: 0.11
Nodes (27): Table(), TableBody(), TableCaption(), TableCell(), TableFooter(), TableHead(), TableHeader(), TableRow() (+19 more)

### Community 20 - "backupArchive.test.mjs"
Cohesion: 0.08
Nodes (23): BackupArchiveError, readEntryText(), restoreBackupArchive(), rowsFromJsonArray(), rowsFromJsonl(), tableNameFromEntry(), buildArchive(), modelFile (+15 more)

### Community 21 - "dataapi.go"
Cohesion: 0.15
Nodes (36): sendRawJSON(), commandDisplay(), sendBambuCommand(), auditDataApi(), dataApiMethodNotAllowed(), extractApiKey(), handleDataApi(), handleDataApiAnalytics() (+28 more)

### Community 22 - "oauthApi.ts"
Cohesion: 0.23
Nodes (11): KeycloakSsoSettings(), EnabledOAuthProviders, fetchOAuthSettings(), MutationResult, OAuthSettings, OAuthSettingsInput, OAuthUser, readError() (+3 more)

### Community 23 - "homeassistant.go"
Cohesion: 0.13
Nodes (35): callHaService(), decodeBodyRawMap(), dispatchPrintControl(), evaluateHaRules(), getHomeAssistantConfig(), getPrinterStatusByID(), haConfigPayload(), haErrorDetail() (+27 more)

### Community 24 - "isRedisEnabled"
Cohesion: 0.12
Nodes (41): cacheSession(), checkBucket(), checkBucketMemory(), checkUsernameLock(), clearBucket(), clearCredentialAttempts(), clearUsernameLock(), getCachedSession() (+33 more)

### Community 25 - "run"
Cohesion: 0.10
Nodes (21): accumulate_total_print_time(), apply_slicer_filament_estimate(), get_refresh_pool(), _handle_shutdown(), list_discord_webhooks(), owns_printer(), persist_signature(), prune_bambu_clients() (+13 more)

### Community 26 - "AuthContext.tsx"
Cohesion: 0.12
Nodes (18): AuthContext, AuthContextType, ChangePasswordResult, ChangeRoleResult, CreateUserInput, CreateUserResult, DEFAULT_USERS, LoginResult (+10 more)

### Community 27 - "CameraStream"
Cohesion: 0.20
Nodes (4): buildRtspUrl(), CameraStream, ffmpegArgs(), sanitizeCameraError()

### Community 28 - "net/http.ResponseWriter"
Cohesion: 0.22
Nodes (37): decodePathSegment(), respondShaped(), readJSONBody(), handleBrandingPut(), handlePrinterCommand(), handleDataApiAdminCredential(), handleDataApiUsers(), handleNotificationsRoutes() (+29 more)

### Community 29 - "Maintenance.tsx"
Cohesion: 0.08
Nodes (41): MaintenanceIntervalsSettings(), Badge(), badgeVariants, AuditActor, AuditLogEntry, currentActor, fetchAuditLogs(), completeMaintenanceTask() (+33 more)

### Community 30 - "context.Context"
Cohesion: 0.10
Nodes (48): buildID(), handleManagerRoutes(), trimmedPtr(), layoutShape(), buildPrinterListSelect(), allArraysHasElems(), approveManagerRequest(), clearManagerRequestKeySecret() (+40 more)

### Community 31 - "3D-FarmLab"
Cohesion: 0.09
Nodes (22): 3D-FarmLab, 🔑 API Keys and `/api/v1`, 🏗️ Architecture, ⚙️ Environment, ✨ Features, 🧵 Filament Station, 🏠 Home Assistant Integration, 🏭 Image builds (CI) (+14 more)

### Community 32 - "BottomTabBar.tsx"
Cohesion: 0.15
Nodes (12): analyticsTab, filamentStationTab, maintenanceTab, primaryTabs, TabConfig, Sheet(), SheetContent(), SheetDescription() (+4 more)

### Community 33 - "printerConn"
Cohesion: 0.18
Nodes (16): addCameraViewer(), captureBambuSnapshot(), getCameraSnapshotHub(), applyProxyHeaders(), encodeSegments(), handleBambuWebcam(), handlePrinterProxy(), handleWebcamStream() (+8 more)

### Community 34 - "net/http.Request"
Cohesion: 0.11
Nodes (49): claimBoolIsFalse(), containsString(), decodeJwtClaims(), exchangeOAuthCode(), handleOAuthProvider(), isOAuthConfigured(), oauthAuthorizeEndpoint(), oauthClaimEmail() (+41 more)

### Community 35 - "mStr"
Cohesion: 0.32
Nodes (20): mergeBambuReport(), pmap, parseReport(), TestBambuLoadedSlotID(), TestBuildBambuSpools_MarksActiveSlot(), TestMergeBambuReport_ClearsOnEmptyState(), TestMergeBambuReport_ClearsOnTrayExistBits(), TestMergeBambuReport_DoesNotMutatePreviousResult() (+12 more)

### Community 36 - "routes.tsx"
Cohesion: 0.05
Nodes (79): Printer Logo Icon (SVG), BottomTabBar(), Logo(), LogoProps, LEVEL_BY_KIND, MaintenanceNotifier(), Navigation(), NotificationBell() (+71 more)

### Community 37 - "handleAPI"
Cohesion: 0.17
Nodes (22): handleAPI(), idleCameraHealth(), isPrivileged(), respondStoreJSON(), authProviders(), oauthConfigured(), samlConfigured(), handleFaviconGet() (+14 more)

### Community 38 - "SoftwareUpdateSettings.tsx"
Cohesion: 0.16
Nodes (23): duration(), relativeTime(), RUN_STATE_LABEL, runBadgeClass(), short(), SoftwareUpdateSettings(), TERMINAL_BAD, ApplyResult (+15 more)

### Community 40 - "queue.go"
Cohesion: 0.09
Nodes (42): buildQueueAddedEmbed(), estimateOneQueueJob(), readStoredQueueFile(), runQueueEstimateBackfill(), startQueueEstimateBackfill(), estimateSourceOrNil(), evaluateQueueAvailability(), getQueueAvailabilitySetting() (+34 more)

### Community 41 - "Any"
Cohesion: 0.12
Nodes (29): Any, apply_offline_grace_period(), bambu_active_spool_id(), bambu_door_open(), build_bambu_current_job(), build_bambu_dual_nozzles(), build_bambu_error_message(), build_bambu_fan_speeds() (+21 more)

### Community 42 - "modelViewer.ts"
Cohesion: 0.09
Nodes (20): ModelViewerCanvas(), ModelViewerCanvasProps, ModelViewerControls, ModelViewerCanvas, EXTENSION_FORMATS, HIGH_DETAIL_TRIANGLES, ModelFormat, PREVIEW_HARD_LIMIT_BYTES (+12 more)

### Community 43 - "mMap"
Cohesion: 0.30
Nodes (18): isoTimestamp(), mMap(), discordColorForStatus(), buildFilamentRunoutEmbed(), buildJobTransitionEvent(), buildStatusTransitionEmbed(), buildTempReachedEmbed(), checkFilamentRunout() (+10 more)

### Community 44 - "saml.go"
Cohesion: 0.16
Nodes (26): BuildAuthnRequest(), BuildSpMetadata(), certBody(), contains(), deflateRawBase64(), directChildrenNS(), escapeXML(), firstChildNS() (+18 more)

### Community 45 - "vite.config.js"
Cohesion: 0.12
Nodes (29): createDiscordWebhook(), deleteDiscordWebhook(), deletePrinter(), deleteQueueJob(), listAuditLogs(), listDailyAnalytics(), listDiscordWebhooks(), listQueueData() (+21 more)

### Community 46 - "docker-compose.yml — full stack definition"
Cohesion: 0.15
Nodes (19): db service (PostgreSQL 16), exporter service (Go, ported from Python, Prometheus metrics), nginx reverse proxy, poller service (Go, ported from Python), prometheus service, redis (optional acceleration layer), slicer-proxy service (OctoPrint-compatible upload), web service (Node.js SPA + API host) (+11 more)

### Community 48 - "sanitizePrinterTelemetry"
Cohesion: 0.21
Nodes (18): clampFloat(), finiteOr(), pmap, sanitizeJobMap(), sanitizeNumericSlice(), sanitizePrinterTelemetry(), sanitizeTemp(), isValidUTF8() (+10 more)

### Community 49 - "bambu.go"
Cohesion: 0.14
Nodes (32): bambuActiveSpoolID(), bambuLoadedSlotID(), bambuTrayKey(), buildBambuCurrentJob(), buildBambuDualNozzles(), buildBambuFanSpeeds(), chamberTempCandidates(), decodeBambuChamberTarget() (+24 more)

### Community 50 - "PrinterCardLayout.tsx"
Cohesion: 0.18
Nodes (17): columnDroppableId(), DroppableColumn(), findColumnIndex(), PrinterCardLayout(), PrinterCardLayoutProps, SortableCard(), CARD_IDS, CARD_LABELS (+9 more)

### Community 51 - "DeviceConfig"
Cohesion: 0.06
Nodes (43): esp_event_base_t, configClear(), configLoad(), configSave(), DeviceConfig, commonAnode, mqttHost, mqttPassword (+35 more)

### Community 52 - "entrypoint.sh"
Cohesion: 0.26
Nodes (11): CHILD_NAMES, CHILD_PIDS, EMBED_MCP, EMBED_SLICER_PROXY, fail(), log(), METRICS_LISTEN_PORT, entrypoint.sh script (+3 more)

### Community 53 - "Monitoring — Prometheus"
Cohesion: 0.11
Nodes (18): Checking that scraping works, Connecting Grafana, Cumulative (counter — exposed with the `_total` suffix), Docker Compose, Example PromQL, Exporter self-metrics (gauge), Farm-wide (gauge), How the scrape config works (+10 more)

### Community 54 - "Dashboard.tsx"
Cohesion: 0.06
Nodes (59): AnalyticsCardGrid(), AnalyticsCardGridProps, BREAKPOINTS, buildMobileLayout(), COLS, overlapArea(), Rect, ResponsiveGridLayout (+51 more)

### Community 55 - "BackupSettings.tsx"
Cohesion: 0.10
Nodes (22): BackupSettings(), AlertDialog(), AlertDialogAction(), AlertDialogCancel(), AlertDialogContent(), AlertDialogDescription(), AlertDialogFooter(), AlertDialogHeader() (+14 more)

### Community 56 - "branding.go"
Cohesion: 0.29
Nodes (11): analyzeSvgForTheme(), brandingScaleInput(), capRunes(), decodeSvgDataUrl(), firstGroup(), normalizeSvgSize(), replaceFirst(), sanitizeSvg() (+3 more)

### Community 57 - "NFCService"
Cohesion: 0.14
Nodes (19): CoreNFC, NFCService, .isAvailable, NFCServiceError, .errorDescription, noTagDetected, notNDEFCapable, notWritable (+11 more)

### Community 58 - "parse3mf.js"
Cohesion: 0.19
Nodes (21): CDIR_SIG, EOCD_SIG, extractFilamentGramsFrom3mf(), extractSliceInfoFrom3mf(), findEntryInZip(), LFH_SIG, readEntryData(), readZipEntry() (+13 more)

### Community 59 - "FilamentStationAPI"
Cohesion: 0.22
Nodes (11): decoding, FilamentStationAPI, .isConfigured, Bool, Data, FilamentSpool, String, JSONDecoder (+3 more)

### Community 60 - "send_discord_embed"
Cohesion: 0.40
Nodes (5): A webhook with events == None receives every event (historical default); a list…, Discord only speaks the message `content` aloud (embeds are never read by TTS),…, send_discord_embed(), tts_content_for_embed(), webhook_wants()

### Community 61 - "xlsxExport.ts"
Cohesion: 0.23
Nodes (15): buildSheetXml(), buildZip(), colLetter(), concat(), crc32(), CRC_TABLE, ENC, esc() (+7 more)

### Community 62 - "bambuhms.go"
Cohesion: 0.25
Nodes (16): bambuAMSFamily(), bambuDoorOpen(), bambuErrorMessage(), bambuFilamentRunout(), bambuHMSCodes(), bambuHMSTextFor(), buildBambuErrorMessage(), coerceHMSInt() (+8 more)

### Community 63 - "matchOrCreateFilamentSpools"
Cohesion: 0.31
Nodes (15): createFilamentSpoolFromTray(), ensureAutoAssignment(), findFilamentSpoolByTag(), pgx.Conn, pmap, isValidTag(), isValidTrayUUID(), matchOrCreateFilamentSpools() (+7 more)

### Community 64 - "publicViewerApi.ts"
Cohesion: 0.47
Nodes (5): isPublicViewerAllowed(), fetchPublicViewerSetting(), parseError(), PublicViewerSetting, savePublicViewerSetting()

### Community 65 - "authSessionApi.ts"
Cohesion: 0.29
Nodes (7): fetchSession(), loginSession(), LoginSessionResult, logoutSession(), readError(), SessionRole, SessionUser

### Community 66 - "PrintFarmCollector"
Cohesion: 0.21
Nodes (7): db_url(), main(), PrintFarmCollector, Prometheus exporter for the STEM Lab Print Farm. A standalone, read-only…, Reads the print-farm tables on every scrape and yields metric families., Run every query and build the metric families, or raise on failure. Returns the…, Poller liveness/lag from the poller_health table (one row per shard). Tolerates…

### Community 67 - "rbac.js"
Cohesion: 0.18
Nodes (18): adminMutationCapability(), authorize(), canAccessResource(), CAP, isPublicRead(), operatorMutationCapability(), PUBLIC, PUBLIC_MUTATIONS (+10 more)

### Community 68 - "bambu_error_message"
Cohesion: 0.18
Nodes (12): _bambu_ams_family(), bambu_error_message(), bambu_filament_runout(), _bambu_hms_codes(), _bambu_hms_text(), _coerce_hms_int(), _is_bambu_runout_code(), Bambu sends HMS attr/code as either an int or a hex string ("0x..."). (+4 more)

### Community 69 - "helpers.go"
Cohesion: 0.17
Nodes (25): buildBambuSpools(), clampInt(), crc32sum(), pmap, isNum(), merge(), mFloat(), mFloatDef() (+17 more)

### Community 70 - "command.go"
Cohesion: 0.18
Nodes (21): bambuLightNodes(), buildBambuCommandPayload(), buildBambuLedPayload(), buildBambuTemperatureGcode(), gcodeLinePayload(), isIntegerValue(), isWordByte(), jsInt() (+13 more)

### Community 71 - "SetupView"
Cohesion: 0.15
Nodes (11): App, FilamentStationApp, .body, RootTabView, Void, SetupView, .body, String (+3 more)

### Community 72 - "3D-FarmLab — API Reference"
Cohesion: 0.09
Nodes (22): 3D-FarmLab — API Reference, Authentication, Conventions, Discovery, Example, `GET /api/queue/availability`, `GET /api/settings/oauth/keycloak`, `GET /api/settings/public-viewer` (+14 more)

### Community 74 - "HomeAssistantSettings.tsx"
Cohesion: 0.11
Nodes (32): COMMON_SERVICES, HIDDEN_CARD_DOMAINS, HomeAssistantSettings(), HomeAssistantSettingsProps, PRINTER_COMMANDS, PRINTER_STATUSES, PrintersContext, PrintersContextValue (+24 more)

### Community 75 - "printEstimate.js"
Cohesion: 0.22
Nodes (24): accumulateMesh(), accumulateObject(), addTriangle(), attr(), componentRe(), finishAccumulator(), itemRe(), loadModelPart() (+16 more)

### Community 76 - "Connection"
Cohesion: 0.15
Nodes (17): Connection, accrue_print_hours_and_trigger_maintenance(), collect_analytics_for_transition(), ensure_bambu_slicer_estimate(), ensure_schema(), finalize_job_analytics(), get_bambu_client(), list_slicer_estimates() (+9 more)

### Community 78 - "Resources"
Cohesion: 0.12
Nodes (17): Admin credential — `/api/v1/admin-credential`, Analytics — `/api/v1/analytics`, Audit logs — `/api/v1/audit-logs`, Filament Station — `/api/v1/filament-station` (also `/api/filament-station`, cookie-session), Hardware control (non-Bambu) — `/printers/:id/proxy/<path…>`, Maintenance — `/api/v1/maintenance`, Manager access requests — `/api/v1/manager-requests`, Migration (host → host) (+9 more)

### Community 79 - "Writer"
Cohesion: 0.10
Nodes (29): analyticsMetrics(), build(), collect(), f(), pgx.Conn, main(), networkUsageMetrics(), pollerMetrics() (+21 more)

### Community 80 - "menubar.tsx"
Cohesion: 0.12
Nodes (11): Menubar(), MenubarCheckboxItem(), MenubarContent(), MenubarItem(), MenubarLabel(), MenubarRadioItem(), MenubarSeparator(), MenubarShortcut() (+3 more)

### Community 81 - "FilamentSpool"
Cohesion: 0.14
Nodes (16): Codable, CodingKey, Double, Foundation, Hashable, Identifiable, CodingKeys, matched (+8 more)

### Community 83 - "form.tsx"
Cohesion: 0.10
Nodes (23): react, react, ChartConfig, ChartContainer(), ChartContext, ChartContextProps, ChartLegendContent(), ChartTooltipContent() (+15 more)

### Community 84 - "public/icons.svg (icon sprite sheet)"
Cohesion: 0.29
Nodes (7): public/icons.svg (icon sprite sheet), bluesky-icon symbol, discord-icon symbol, documentation-icon symbol (open-book glyph), github-icon symbol (GitHub cat mark), social-icon symbol (people/share glyph), x-icon symbol (X/Twitter mark)

### Community 85 - "Settings.tsx"
Cohesion: 0.09
Nodes (44): RFC-4122, Alert(), AlertDescription(), AlertTitle(), alertVariants, generateId(), slugifyPrinterId(), approveManagerRequest() (+36 more)

### Community 86 - "PrintFarm — Security Architecture & Hardening Plan"
Cohesion: 0.12
Nodes (15): 10. Low-Priority Improvements, 12. Secure Coding Guidelines, 13. Deployment Hardening Checklist, 14. Penetration Testing Checklist, 15. DevSecOps Recommendations, 16. Disaster Recovery, 17. Incident Response Plan, 18. Future Security Improvements (+7 more)

### Community 87 - "🚀 Quick Start"
Cohesion: 0.50
Nodes (4): Frontend-only development, Multi-container stack (when you need the pieces back), Production deploy (manual), 🚀 Quick Start

### Community 88 - "App.tsx"
Cohesion: 0.14
Nodes (10): App(), RootErrorBoundary, BrandingApplier(), ThemeProvider(), Toaster(), DEFAULT_SITE_NAME, fetchBuildId(), useDeployDetector() (+2 more)

### Community 89 - "detectBambuAssignmentTriggers"
Cohesion: 0.42
Nodes (9): bambuTrayLoaded(), deleteAssignmentByID(), detectBambuAssignmentTriggers(), pgx.Conn, pmap, listAssignmentsForPrinter(), markAssignmentNeedsTrigger(), trayColorHex() (+1 more)

### Community 91 - "cn"
Cohesion: 0.04
Nodes (51): AccordionContent(), AccordionItem(), AccordionTrigger(), Avatar(), AvatarFallback(), AvatarImage(), BreadcrumbEllipsis(), BreadcrumbItem() (+43 more)

### Community 92 - "MCP server (`mcp` service)"
Cohesion: 0.17
Nodes (9): AI-agent least privilege (`MCP_ADMIN_MODE`), Authentication, Development / testing, Local (stdio) — e.g. Claude Desktop, MCP server (`mcp` service), Notes / caveats, Remote (Streamable HTTP), Tools (+1 more)

### Community 93 - "filamentStation.js"
Cohesion: 0.11
Nodes (35): runFilamentAssignmentReplayPass(), scheduleFilamentAssignmentReplayWorker(), BAMBU_CALIBRATION_OPTIONS, BAMBU_FILAMENT_PRESETS, BAMBU_LIGHT_NODES, BAMBU_PRINT_ACTIONS, BAMBU_PROFILES, bambuLightNodes() (+27 more)

### Community 94 - "notify.go"
Cohesion: 0.42
Nodes (10): fetchBambuSnapshot(), fetchPrinterSnapshot(), fileHeader(), pmap, grabMJPEGFrame(), postJSON(), postSnapshot(), sendDiscordEmbed() (+2 more)

### Community 96 - "public/icon.svg (PrintFarm App Icon)"
Cohesion: 0.67
Nodes (3): 3D Printer Iconography (device silhouette with print bed/nozzle), PrintFarm Branding / Visual Identity, public/icon.svg (PrintFarm App Icon)

### Community 98 - "Alert response"
Cohesion: 0.17
Nodes (11): Alert response, Common operations, ExporterScrapeFailing / ExporterDown (critical), Health & readiness endpoints, Metrics map, Operations Runbook, PollerRefreshFailures (warning), PollerStalled (critical) (+3 more)

### Community 101 - "statusLightBroker.js"
Cohesion: 0.20
Nodes (15): buildStatusLightDeviceRoster(), buildStatusLightProvisioning(), devices, ensureBrokerCredential(), getStatusLightDevices(), lastPublished, markDevice(), printerIdFromClientId() (+7 more)

### Community 107 - "handleDataApiSlicerKeys"
Cohesion: 0.13
Nodes (28): authorizeFrontendApi(), buildSessionCookie(), classifyApiRequest(), clearSessionCookie(), isAdminMutation(), isOperatorMutation(), isPrivilegedRole(), isSameOriginWrite() (+20 more)

### Community 108 - "metrics.js"
Cohesion: 0.10
Nodes (26): deltaSince(), flushNetworkUsagePass(), handleRequest(), isMcpPath(), isSlicerProxyPath(), setSecurityHeaders(), bytesByRoute, bytesInByRoute (+18 more)

### Community 109 - "_fetch_bambu_3mf"
Cohesion: 0.25
Nodes (7): _bambu_3mf_candidates(), _fetch_bambu_3mf(), _ImplicitFtpTls, _open_bambu_ftp(), FTP_TLS that does the TLS handshake immediately on connect (implicit FTPS).…, Likely FTP paths of the active print's .3mf, most-specific first. Where the…, Download the active print's .3mf over implicit FTPS, or None on any failure.

### Community 110 - "bambumerge.go"
Cohesion: 0.32
Nodes (13): pmap, isGenuineTagValue(), mergeAmsPayload(), mergeAmsUnit(), mergeAmsUnits(), mergeTray(), mergeTrays(), TestIsGenuineTagValue() (+5 more)

### Community 111 - "Endpoints"
Cohesion: 0.25
Nodes (8): Endpoints, `GET /api/auth/keycloak/callback`, `GET /api/auth/keycloak/config`, `GET /api/auth/keycloak/start`, `GET /api/auth/providers`, `GET /launch`, `POST /api/auth/verify`, SSO sign-in API (`/api/auth`)

### Community 112 - "handleRequest"
Cohesion: 0.11
Nodes (20): envOr(), init(), logDebug(), logEmit(), logError(), logInfo(), logWarn(), main() (+12 more)

### Community 113 - "adminCredentialApi.ts"
Cohesion: 0.47
Nodes (4): changeAdminCredential(), MutationResult, readError(), setupAdminCredential()

### Community 114 - "Security Policy"
Cohesion: 0.15
Nodes (11): .apiKey, .baseURL, KeychainStore, String, Security, Deployment Hardening, Disclosure Policy, Reporting a Vulnerability (+3 more)

### Community 116 - "Agent Notes"
Cohesion: 0.20
Nodes (9): Agent Notes, Code Style, Guidelines, Operational Behavior, Project, Project Idea, Run Dev, Run The Project (+1 more)

### Community 117 - "2.2 Component threat tables"
Cohesion: 0.17
Nodes (12): 2.1 Attack-surface inventory, 2.2 Component threat tables, 2. Threat Model, A. Authentication (`/api/auth/*`, sessions, SSO/OAuth/SAML), B. Frontend API (`/api/*`), C. Database (Postgres), D. Printer Proxy & printer protocols, E. AI Agent / MCP (`/mcp`, `mcp/`) (+4 more)

### Community 118 - "Endpoints"
Cohesion: 0.20
Nodes (10): `DELETE /api/manager/requests/:id`, End-to-end flow example, Endpoints, `GET /api/manager/requests`, `GET /api/manager/requests/:id/status`, Manager Access Request API (`/api/manager`), `POST /api/manager/request`, `POST /api/manager/requests/:id/approve` (+2 more)

### Community 119 - "CLAUDE.md"
Cohesion: 0.20
Nodes (8): Architecture, Code Style, Commands, graphify, Guidelines, Key Operational Behaviors, Project, Security (read before touching auth, routes, secrets, or errors)

### Community 120 - "printEstimate.test.mjs"
Cohesion: 0.23
Nodes (10): DEFAULT_CONFIG, asciiStlCube(), binaryStlCube(), buildZip(), cubeTriangles(), meshThreeMf(), objCube(), opts (+2 more)

### Community 121 - "Frontend session API (`/api/auth/*`)"
Cohesion: 0.22
Nodes (9): Authorization matrix (frontend `/api/*`), Backup & Restore (admin — Settings → System), Endpoints, Frontend session API (`/api/auth/*`), Maintenance (frontend `/api/*`), Network usage (frontend `/api/*`), Real-time events (frontend `/api/*`), Software update (admin — Settings → Maintenance) (+1 more)

### Community 122 - "notify_for_transition"
Cohesion: 0.23
Nodes (13): build_filament_runout_embed(), build_job_transition_event(), build_status_transition_embed(), build_temp_reached_embed(), check_filament_runout(), discord_color_for_status(), humanize_spool_id(), iso_timestamp() (+5 more)

### Community 123 - "Home Assistant (`/api/settings/home-assistant`)"
Cohesion: 0.22
Nodes (9): `DELETE /api/settings/home-assistant/rules/:id`, `GET /api/settings/home-assistant`, `GET /api/settings/home-assistant/devices`, `GET /api/settings/home-assistant/rules`, Home Assistant (`/api/settings/home-assistant`), `POST /api/settings/home-assistant/rules`, `POST /api/settings/home-assistant/test`, `PUT /api/settings/home-assistant` (+1 more)

### Community 124 - "publish_live_telemetry"
Cohesion: 0.31
Nodes (9): publish_live_telemetry(), Best-effort mirror of one printer's volatile telemetry to Redis. No-op when…, _get_client(), is_redis_enabled(), publish_printer_telemetry(), Optional Redis acceleration layer for the poller. Redis is strictly optional.…, Lazily build a fail-fast client. Short timeouts so a dead Redis can't stall the…, Write a printer's live telemetry as a Redis hash (printer:<id>:live), values… (+1 more)

### Community 125 - "parse3mfFilamentSlots"
Cohesion: 0.31
Nodes (9): parse3mfFilamentSlots(), build3mf(), TestParse3mfFilamentSlots_MissingOrZeroUsedGSkipped(), TestParse3mfFilamentSlots_MultiplePlatesAndFilaments(), TestParse3mfFilamentSlots_NoSliceInfoConfig(), TestParse3mfFilamentSlots_NotAZip(), sliceInfoConfigXML, sliceInfoFilamentXML (+1 more)

### Community 126 - "queueEstimateBackfill.js"
Cohesion: 0.31
Nodes (10): envNumber(), estimateConfigFromEnv(), estimateFromModel(), extensionOf(), geometryToEstimate(), estimateOneJob(), readStoredFile(), runBackfill() (+2 more)

### Community 127 - "certpin.go"
Cohesion: 0.22
Nodes (14): certFingerprint(), evaluatePin(), fingerprintsMatch(), normalizeFingerprint(), parseCertPins(), selfSignedDER(), TestCertFingerprintStableAndPrefixed(), TestEvaluatePin() (+6 more)

### Community 128 - "oauthGrant.js"
Cohesion: 0.46
Nodes (7): decode(), encode(), mintAuthGrant(), sign(), signState(), verifyAuthGrant(), verifyState()

### Community 195 - "tenantContext.test.mjs"
Cohesion: 0.46
Nodes (4): CROSS_TENANT_CONTEXT, normalizeTenantId(), tenantContextFor(), withTenantContext()

### Community 196 - "security-smoke.sh"
Cohesion: 0.36
Nodes (6): bad(), check_hdr(), hr(), note(), ok(), security-smoke.sh script

### Community 197 - "usersApi.ts"
Cohesion: 0.31
Nodes (8): changeUserPasswordApi(), changeUserRoleApi(), createUserApi(), CreateUserApiResult, deleteUserApi(), MutationResult, readError(), StaffUser

### Community 198 - "Config"
Cohesion: 0.17
Nodes (13): ConfigFromEnv(), envFloat(), Config, geometryToEstimate(), newAccumulator(), parseASCIISTL(), parseBinarySTL(), parseOBJ() (+5 more)

### Community 199 - "Operational endpoints"
Cohesion: 0.50
Nodes (4): `GET /healthz`, `GET /metrics`, `GET /readyz`, Operational endpoints

### Community 200 - "SpoolListView"
Cohesion: 0.17
Nodes (11): .body, ScanView, .body, FilamentSpool, Color, SpoolListView, .body, FilamentSpool (+3 more)

### Community 201 - "web/metrics.go"
Cohesion: 0.31
Nodes (8): classifyRoute(), normalizeMethod(), numStr(), recordRequestEnd(), recordRequestStart(), renderMetrics(), residentMemoryBytes(), histogram

### Community 202 - "printer_status_poller.py"
Cohesion: 0.12
Nodes (21): Exception, build_current_job(), build_spools_from_task_config(), connect_db(), db_url(), decrypt_secret(), encrypt_secret(), fetch_bambu_snapshot() (+13 more)

### Community 203 - "Client"
Cohesion: 0.33
Nodes (4): FromEnv(), sync.Once, redis.Client, Client

### Community 204 - "11. Refactoring Plan"
Cohesion: 0.25
Nodes (8): 11.1 Invert the API authorization gate (fixes S-1) — highest ROI, 11.2 Split the 285 KB `server/app.js`, 11.3 Consolidate credential/authn into an auth module, 11.4 Data-tier: least privilege, segmentation, RLS, 11.5 Container hardening (compose), 11.6 AI-agent boundary (fixes S-5 tail), 11.7 Secrets management (fixes secret-in-`.env`), 11. Refactoring Plan

### Community 205 - "threemf.go"
Cohesion: 0.20
Nodes (17): ExtractSliceInfo(), normalizePartPath(), parse3mfMesh(), readZipEntry(), transformDeterminant(), meshContext, modelComponentXML, modelItemXML (+9 more)

### Community 206 - "package.json"
Cohesion: 0.15
Nodes (12): name, vite, pnpm, overrides, private, scripts, build, dev (+4 more)

### Community 207 - "jsWriteValue"
Cohesion: 0.48
Nodes (6): jsWriteNumber(), jsWriteString(), jsWriteValue(), bytes.Buffer, encoding/json.Decoder, encoding/json.Number

### Community 208 - ".RoundTrip"
Cohesion: 0.33
Nodes (4): isPrivateHost(), isPrivateIP(), net/http.Response, net.IP

### Community 209 - "time.Duration"
Cohesion: 0.14
Nodes (14): durationFromMs(), envInt(), envIntMin(), maxDuration(), maxInt(), estimateRequestLineBytes(), getJSON(), pmap (+6 more)

### Community 210 - "toggle-group.tsx"
Cohesion: 0.43
Nodes (5): ToggleGroup(), ToggleGroupContext, ToggleGroupItem(), Toggle(), toggleVariants

### Community 211 - "Print-Farm Status Light (ESP32-C3 Super Mini)"
Cohesion: 0.33
Nodes (5): Build, MQTT contract, Print-Farm Status Light (ESP32-C3 Super Mini), Provisioning (serial protocol), Wiring

### Community 212 - "Go web/api port — roadmap"
Cohesion: 0.29
Nodes (6): Go web/api port — roadmap, Known risk / parity notes, Module layout (planned), Phased plan (each phase build + parity-verify + commit), Status, Verification strategy

### Community 213 - "APIError"
Cohesion: 0.33
Nodes (6): APIError, .errorDescription, http, notConfigured, Int, LocalizedError

### Community 214 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, tailwindcss, @tailwindcss/vite, @types/react-grid-layout, @types/three, vite, @vitejs/plugin-react, tailwindcss (+5 more)

### Community 215 - "slicerGrant.js"
Cohesion: 0.47
Nodes (4): mintSlicerGrant(), SECRET, sign(), verifySlicerGrant()

### Community 216 - "WriteTagView"
Cohesion: 0.60
Nodes (3): FilamentSpool, WriteTagView, .body

### Community 217 - "1. Security Assessment"
Cohesion: 0.40
Nodes (5): 1.1 What the platform is, 1.2 Current security posture — the good, 1.3 The core structural risks, 1.4 Overall rating, 1. Security Assessment

### Community 219 - "Multi-tenant isolation (S-2 phase 2)"
Cohesion: 0.33
Nodes (5): Multi-tenant isolation (S-2 phase 2), Pieces, Rollout order, Still to do (phase 3 — needs product decisions + a DB), Verify (run against your DB)

### Community 220 - "Filament Station — iOS (Core NFC)"
Cohesion: 0.50
Nodes (3): Filament Station — iOS (Core NFC), Screens, What needs real-device verification (can't be checked here)

### Community 221 - "5. Authentication Flow"
Cohesion: 0.50
Nodes (4): 5.1 Target design (keep cookie sessions; add token layer for API/AI; MFA-ready), 5.2 Token model (the requirements' JWT/refresh/rotation asks, done safely), 5.3 Secret storage for tokens, 5. Authentication Flow

### Community 222 - "6. Authorization Model"
Cohesion: 0.50
Nodes (4): 6.1 Target RBAC hierarchy, 6.2 Enforcement model — "no implicit trust", every endpoint explicit, 6.3 API-key scopes (kill the "god scope", S-3), 6. Authorization Model

### Community 223 - "Appendix A — OWASP mapping"
Cohesion: 0.50
Nodes (4): Appendix A — OWASP mapping, ASVS / Proactive Controls, OWASP API Security Top 10 (2023), OWASP Top 10 (2021)

### Community 224 - "resolveSlotToTray"
Cohesion: 0.23
Nodes (14): decodeMqttMapping(), matchSlotsByColor(), normalizeColorHex(), resolveSlotToTray(), TestDecodeMqttMapping(), TestDecodeMqttMapping_AllUnmapped(), TestDecodeMqttMapping_Empty(), TestMatchSlotsByColor_AmbiguousReturnsNil() (+6 more)

### Community 225 - "refreshStatus"
Cohesion: 0.22
Nodes (12): applyOfflineGracePeriod(), buildOfflinePrinterState(), pmap, nowSeconds(), computeNextPrinter(), pmap, isExpectedOffline(), refreshStatus() (+4 more)

### Community 228 - "ensureBambuSlicerEstimate"
Cohesion: 0.32
Nodes (12): applySlicerFilamentEstimate(), bambu3mfCandidates(), ensureBambuSlicerEstimate(), fetchBambu3mf(), pgx.Conn, pmap, maybeRecordBambu3mfEstimate(), minF() (+4 more)

### Community 277 - "uploadToBambu"
Cohesion: 0.21
Nodes (10): normalizeColor(), resolveAmsMapping(), bambuSubtaskName(), buildTmpFileUrl(), getConfiguredPrinterCallbackUrl(), normalizePrinterCallbackUrl(), publishBambuPrint(), registerTmpFile() (+2 more)

### Community 278 - "AuthProvider"
Cohesion: 0.24
Nodes (11): AuthProvider(), clearStoredSession(), createViewerSession(), loadUsers(), readStoredSession(), sanitizeUser(), takeOAuthGrantToken(), takeSlicerGrantToken() (+3 more)

### Community 279 - "fetchLatestPublishedVersion"
Cohesion: 0.43
Nodes (5): fetchLatestPublishedVersion(), hubFetch(), DOCKER_REPO_PATTERN, resolvePublishedVersion(), tagDigests()

### Community 280 - "secretCrypto.js"
Cohesion: 0.47
Nodes (4): decryptSecret(), encryptSecret(), isEncrypted(), KEY

## Ambiguous Edges - Review These
- `public/icons.svg (icon sprite sheet)` → `documentation-icon symbol (open-book glyph)`  [AMBIGUOUS]
  public/icons.svg · relation: conceptually_related_to
- `public/icons.svg (icon sprite sheet)` → `github-icon symbol (GitHub cat mark)`  [AMBIGUOUS]
  public/icons.svg · relation: conceptually_related_to

## Knowledge Gaps
- **636 isolated node(s):** `CHILD_PIDS`, `CHILD_NAMES`, `EMBED_SLICER_PROXY`, `EMBED_MCP`, `METRICS_LISTEN_PORT` (+631 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **123 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `public/icons.svg (icon sprite sheet)` and `documentation-icon symbol (open-book glyph)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `public/icons.svg (icon sprite sheet)` and `github-icon symbol (GitHub cat mark)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `dependencies` connect `dependencies` to `@radix-ui/react-select`, `@radix-ui/react-separator`, `@radix-ui/react-slot`, `@radix-ui/react-toggle`, `@radix-ui/react-tooltip`, `react-dom`, `react-grid-layout`, `react-hook-form`, `react-router`, `recharts`, `sonner`, `tailwind-merge`, `three`, `tw-animate-css`, `ws`, `xml-crypto`, `@xmldom/xmldom`, `xpath`, `zod`, `busboy`, `package.json`, `form.tsx`, `class-variance-authority`, `clsx`, `date-fns`, `@dnd-kit/core`, `@dnd-kit/utilities`, `ioredis`, `lucide-react`, `next-themes`, `esptool-js`, `pg`, `@radix-ui/react-accordion`, `@radix-ui/react-alert-dialog`, `@radix-ui/react-aspect-ratio`, `@radix-ui/react-avatar`, `@radix-ui/react-checkbox`, `@radix-ui/react-collapsible`, `@radix-ui/react-context-menu`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-hover-card`, `@radix-ui/react-menubar`, `@radix-ui/react-navigation-menu`, `@radix-ui/react-radio-group`, `@radix-ui/react-scroll-area`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Why does `react` connect `form.tsx` to `sidebar.tsx`, `dependencies`, `toggle-group.tsx`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **Why does `aedes` connect `dependencies` to `statusLightBroker.js`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `handleApi()` (e.g. with `stripPrinterConnectionSecret()` and `.addEntry()`) actually correct?**
  _`handleApi()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `CHILD_PIDS`, `CHILD_NAMES`, `EMBED_SLICER_PROXY` to the rest of the system?**
  _636 weakly-connected nodes found - possible documentation gaps or missing edges._