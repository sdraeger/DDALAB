// WebGL2 helpers and the bridge from CSS colour tokens to drawing colours.

/** A WebGL2 context for drawing traces over a transparent canvas; `null` where the browser has none. */
export function webgl2(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  return canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });
}

function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const compiled = gl.createShader(type) as WebGLShader;
  gl.shaderSource(compiled, source);
  gl.compileShader(compiled);
  if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(`shader: ${gl.getShaderInfoLog(compiled)}`);
  }
  return compiled;
}

/** Compiles and links a program; the uniforms come back by name. */
export function program(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const linked = gl.createProgram() as WebGLProgram;
  gl.attachShader(linked, shader(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(linked, shader(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(linked);
  if (!gl.getProgramParameter(linked, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`program: ${gl.getProgramInfoLog(linked)}`);
  }
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  const uniform = (name: string) => {
    if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(linked, name));
    return uniforms.get(name) ?? null;
  };
  return { program: linked, uniform };
}

/**
 * The colour a CSS value resolves to on `element` (tokens are light-dark() pairs, resolved by the element's colour
 * scheme), as `rgb()` text for 2D canvases and as 0..1 components for WebGL.
 */
export function cssColor(
  element: Element,
  value: string,
): { css: string; rgba: [number, number, number, number] } {
  const probe = document.createElement("span");
  probe.style.color = value;
  probe.style.display = "none";
  element.append(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  const parts = css.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  // `color(srgb r g b)` gives 0..1 components, `rgb(r, g, b)` 0..255.
  const scale = css.startsWith("color(") ? 1 : 255;
  const [r, g, b] = parts.slice(0, 3).map((p) => p / scale);
  const a = parts.length > 3 ? parts[3] : 1;
  return { css, rgba: [r, g, b, a] };
}
