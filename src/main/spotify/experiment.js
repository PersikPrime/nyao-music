// Keep the production account and experimental account independent.
export class SpotifyExperiment {
  constructor({ standardApi, standardEngine, nativeApi, nativeEngine, allowed, settings }) {
    Object.assign(this, { standardApi, standardEngine, nativeApi, nativeEngine, allowed, settings });
    this.api = this.proxy(() => this.active ? this.nativeApi : this.standardApi);
    this.engine = this.proxy(() => this.active ? this.nativeEngine : this.standardEngine);
  }
  get visible() { return this.allowed() && this.settings.get().experimentalLibrespot === true; }
  get active() { return this.visible && this.nativeEngine.available && this.nativeApi.loggedIn && this.settings.get().librespotActive === true; }
  proxy(select) {
    return new Proxy({}, { get: (_target, key) => {
      const object = select();
      const value = object[key];
      return typeof value === 'function' ? (...args) => {
        const current = select(); return current[key](...args);
      } : value;
    } });
  }
  select(on) {
    if (on) this.standardEngine.release();
    else this.nativeEngine.release();
    this.settings.set({ librespotActive: !!on });
  }
  fallbackFromMetadataFailure() {
    if (!this.active || !this.standardApi.loggedIn || this.standardApi.regionBlocked ||
        !['metadata_failed', 'metadata_denied'].includes(this.nativeEngine.status?.code)) return false;
    this.select(false);
    return true;
  }
  disable() {
    this.nativeEngine.release();
    this.settings.set({ experimentalLibrespot: false, librespotActive: false });
  }
}
