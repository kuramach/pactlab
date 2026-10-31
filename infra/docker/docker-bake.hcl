# Both images in one parallel build (deploy.yml), sharing the dependency and
# build layers. Layers are cached in GitHub Actions' cache between runs: the
# server image is the same for every environment; the web image compiles its
# environment's public settings, so its cache is kept per environment.

variable "REGISTRY" { default = "local" }
variable "ENV_NAME" { default = "dev" }
variable "TAG" { default = "local" }
variable "APP_ENV" { default = "dev" }
variable "ORIGIN" { default = "https://dev.pactlab.ai" }
# Set to "gha" in GitHub Actions; empty locally (no remote cache).
variable "CACHE" { default = "" }

group "default" {
  targets = ["server", "web"]
}

target "_common" {
  context    = "."
  dockerfile = "infra/docker/Dockerfile"
  platforms  = ["linux/arm64"]
  attest     = ["type=provenance,disabled=true"]
}

target "server" {
  inherits   = ["_common"]
  target     = "server"
  tags       = ["${REGISTRY}/pactlab-${ENV_NAME}-server:${TAG}"]
  cache-from = CACHE == "gha" ? ["type=gha,scope=server"] : []
  cache-to   = CACHE == "gha" ? ["type=gha,mode=max,scope=server"] : []
}

target "web" {
  inherits = ["_common"]
  target   = "web"
  tags     = ["${REGISTRY}/pactlab-${ENV_NAME}-web:${TAG}"]
  args = {
    NEXT_PUBLIC_APP_ENV    = APP_ENV
    NEXT_PUBLIC_API_ORIGIN = ORIGIN
  }
  cache-from = CACHE == "gha" ? ["type=gha,scope=web-${ENV_NAME}"] : []
  cache-to   = CACHE == "gha" ? ["type=gha,mode=max,scope=web-${ENV_NAME}"] : []
}
