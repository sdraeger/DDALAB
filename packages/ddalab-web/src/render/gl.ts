// WebGL2 helpers: the context the traces draw in and program linking.

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
