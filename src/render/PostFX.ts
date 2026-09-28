import {
  HalfFloatType,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SSRPass } from 'three/examples/jsm/postprocessing/SSRPass.js';
import { getPreset } from './QualityPresets';
import type { GameSettings } from '../types';

/**
 * Cinematic grade applied after tone mapping: subtle chromatic aberration,
 * film grain, vignette, black lift and a screen-warp pulse for supernatural
 * events. Kept deliberately gentle so the picture stays readable.
 */
const CinemaShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDistortion: { value: 0 },
    uGrain: { value: 0.042 },
    uChroma: { value: 0.0012 },
    uVignette: { value: 0.24 },
    uLift: { value: 0.45 },
    uSaturation: { value: 1.05 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uDistortion;
    uniform float uGrain;
    uniform float uChroma;
    uniform float uVignette;
    uniform float uLift;
    uniform float uSaturation;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      vec2 centered = uv - 0.5;
      float r2 = dot(centered, centered);
      float pulse = clamp(uDistortion, 0.0, 1.5);

      // Subtle supernatural warp
      vec2 warped = uv;
      warped.x += sin(uv.y * 40.0 + uTime * 34.0) * 0.0035 * pulse;
      warped.y += cos(uv.x * 34.0 + uTime * 28.0) * 0.0035 * pulse;
      warped = centered * (1.0 - 0.045 * pulse * r2) + 0.5;

      // Radial chromatic aberration
      float ca = uChroma * (0.4 + r2 * 3.0) + 0.004 * pulse * r2;
      vec2 dir = length(centered) > 0.0001 ? centered / length(centered) : vec2(0.0);
      vec3 color;
      color.r = texture2D(tDiffuse, warped + dir * ca).r;
      color.g = texture2D(tDiffuse, warped).g;
      color.b = texture2D(tDiffuse, warped - dir * ca).b;

      // Filmic black lift keeps the facility readable without washing it out
      color += uLift * vec3(0.032, 0.038, 0.052) * (1.0 - color);

      // Gentle vignette (fear vignette is layered by the DOM overlay)
      float vignette = 1.0 - uVignette * smoothstep(0.1, 0.48, r2);
      color *= vignette;

      // Film grain
      float noise = fract(sin(dot(uv + fract(uTime), vec2(12.9898, 78.233))) * 43758.5453);
      color += (noise - 0.5) * uGrain;

      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, uSaturation);

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `,
};

export class PostFX {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly ssrPass: SSRPass;
  private readonly gtaoPass: GTAOPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;
  private readonly cinemaPass: ShaderPass;
  private readonly target: WebGLRenderTarget;
  private scene: Scene;
  private width = 1;
  private height = 1;
  private samples = -1;
  private canMsaa = false;
  private active = false;
  private time = 0;
  private distortion = 0;
  private settings: GameSettings | null = null;

  constructor(private readonly renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    this.scene = scene;

    const supportsFloat = renderer.extensions.has('EXT_color_buffer_float');
    const supportsHalf = renderer.extensions.has('EXT_color_buffer_half_float');
    this.canMsaa = supportsFloat || supportsHalf;

    // EffectComposer treats constructor sizes as CSS pixels and applies the
    // renderer pixel ratio itself, so keep everything in CSS space here.
    const size = renderer.getSize(new Vector2());
    this.width = Math.max(1, size.x);
    this.height = Math.max(1, size.y);
    this.target = new WebGLRenderTarget(16, 16, {
      type: this.canMsaa ? HalfFloatType : UnsignedByteType,
    });
    this.composer = new EffectComposer(renderer, this.target);

    this.renderPass = new RenderPass(scene, camera);
    this.ssrPass = new SSRPass({
      renderer,
      scene,
      camera,
      width: this.width,
      height: this.height,
      selects: null,
      groundReflector: null,
    });
    this.ssrPass.opacity = 0.4;
    this.ssrPass.maxDistance = 4.5;
    this.ssrPass.thickness = 0.35;
    this.ssrPass.blur = true;

    this.gtaoPass = new GTAOPass(scene, camera, this.width, this.height);
    this.gtaoPass.blendIntensity = 0.85;
    this.gtaoPass.updateGtaoMaterial({
      radius: 0.3,
      distanceExponent: 1.6,
      thickness: 0.5,
      scale: 1.1,
      samples: 16,
      distanceFallOff: 1,
      screenSpaceRadius: false,
    });

    this.bloomPass = new UnrealBloomPass(new Vector2(this.width, this.height), 0.4, 0.7, 0.85);
    this.outputPass = new OutputPass();
    this.cinemaPass = new ShaderPass(CinemaShader);
    (this.cinemaPass.material as ShaderMaterial).toneMapped = false;

    // Order matters: when SSR is enabled it renders the scene itself, so it
    // takes the place of RenderPass. GTAO then darkens the composited result,
    // followed by bloom, tone mapping and the final cinematic grade.
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.ssrPass);
    this.composer.addPass(this.gtaoPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.cinemaPass);

    this.renderPass.enabled = true;
    this.ssrPass.enabled = false;
    this.gtaoPass.enabled = false;
    this.bloomPass.enabled = false;

    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(this.width, this.height);
    this.ssrPass.setSize(this.width * renderer.getPixelRatio(), this.height * renderer.getPixelRatio());
    this.gtaoPass.setSize(this.width * renderer.getPixelRatio(), this.height * renderer.getPixelRatio());
    this.bloomPass.setSize(this.width * renderer.getPixelRatio(), this.height * renderer.getPixelRatio());
  }

  public setScene(scene: Scene): void {
    this.scene = scene;
    this.renderPass.scene = scene;
    this.ssrPass.scene = scene;
    this.gtaoPass.scene = scene;
  }

  public setActiveCamera(camera: Camera): void {
    this.renderPass.camera = camera;
    this.ssrPass.camera = camera;
    this.gtaoPass.camera = camera;
  }

  public applySettings(settings: GameSettings): void {
    this.settings = settings;
    const graphics = settings.graphics;
    const preset = getPreset(graphics.quality);
    const post = graphics.postProcessing;
    const wantSSR = post && graphics.reflectionQuality === 'high';
    const wantAO = post && graphics.ambientOcclusion;
    const wantBloom = post && graphics.bloom;
    const effects = graphics.effects;

    this.active = post;
    this.renderPass.enabled = post && !wantSSR;
    this.ssrPass.enabled = wantSSR;
    this.gtaoPass.enabled = wantAO;
    this.bloomPass.enabled = wantBloom;
    this.outputPass.enabled = post;
    this.cinemaPass.enabled = post;

    const uniforms = (this.cinemaPass.material as ShaderMaterial).uniforms;
    uniforms.uGrain.value = effects ? 0.042 : 0;
    uniforms.uChroma.value = effects ? 0.0012 : 0;
    uniforms.uVignette.value = effects ? 0.24 : 0.1;
    uniforms.uDistortion.value = 0;
    this.distortion = 0;

    this.setSamples(graphics.antialias ? preset.msaa : 0);
  }

  /**
   * Sized in CSS pixels; the composer applies the renderer pixel ratio itself.
   */
  public setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.width, this.height);
  }

  /** Screen-space warp used for supernatural events. */
  public pulse(strength: number): void {
    if (!this.settings?.graphics.effects) {
      return;
    }
    this.distortion = Math.min(1.4, this.distortion + strength);
  }

  public get isActive(): boolean {
    return this.active;
  }

  public render(dt: number, scene: Scene, camera: Camera): void {
    this.setActiveCamera(camera);
    if (this.scene !== scene) {
      this.setScene(scene);
    }

    if (!this.active) {
      this.renderer.render(scene, camera);
      return;
    }

    this.time += dt;
    this.distortion = Math.max(0, this.distortion - dt * 1.35);
    const uniforms = (this.cinemaPass.material as ShaderMaterial).uniforms;
    uniforms.uTime.value = this.time;
    uniforms.uDistortion.value = this.distortion;

    this.composer.render(dt);
  }

  private setSamples(samples: number): void {
    const wanted = this.canMsaa ? samples : 0;
    if (this.samples === wanted) {
      return;
    }
    this.samples = wanted;
    this.composer.renderTarget1.samples = wanted;
    this.composer.renderTarget2.samples = wanted;
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer.setSize(this.width, this.height);
  }
}
