// The site's Railway project as code (`railway config plan`, then `railway config apply`, from site/). It holds what
// site/railway.json used to send with each upload, which Railway stops reading on 2026-12-01: the site is built from its
// own Dockerfile; one copy runs, since the linked computers' connections live in its memory; and a new version takes
// over only once /health answers. Restarting the site if it stops, up to 10 times, is Railway's own default, so it isn't
// written here (written, Railway stores it as the default anyway, and every plan would show it). The volume keeps the
// site's records (DATA_DIR, /data) across deploys. Variables stay as they are on Railway: this file never reads or
// writes them.
import { defineRailway, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const pipSiteVolume = volume("pip-site-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "iad", sizeMB: 500 });
  const pipSite = service("pip-site", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: { healthcheckPath: "/health", healthcheckTimeout: 60 },
    replicas: { "iad": 1 },
    volumeMounts: { "/data": pipSiteVolume },
  });

  return project("pip-site", {
    variables: { managed: false },
    resources: [pipSite, pipSiteVolume],
  });
});
