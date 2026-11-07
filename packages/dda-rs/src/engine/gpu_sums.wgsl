// Dot products of the vectors of a batch of DDA windows, one product per workgroup, exact in integers. A window holds
// `vectors` vectors of `rows` rows (gpu_sums.rs: each channel's model terms and derivative); sum s of window w is the
// dot product of the two vectors pairs[s] names. The host scales each vector by a power of two to below 2 in
// magnitude and rounds it to a multiple of 2^-46: a sign and 47 bits in three 16-bit limbs, packed as limbs 0 and 1
// in word x, limb 2 and the sign (bit 31) in word y. Limb products are exact in u32 and the accumulators carry, so
// no float rounding is left for a compiler's fast math to remove (Metal compiles with it); the inputs' rounding is
// the only error.

struct Params {
    rows: u32,
    vectors: u32,
    windows: u32,
    sums: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
// data[(w * vectors + v) * rows + row].
@group(0) @binding(1) var<storage, read> data: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read> pairs: array<vec2<u32>>;
// Per sum, 20 words: for the positive products, then the negative ones, the five limb positions (weights 2^(16 k)),
// each as a low word and a carry count.
@group(0) @binding(3) var<storage, read_write> sums: array<u32>;

fn limbs(v: vec2<u32>) -> array<u32, 3> {
    return array<u32, 3>(v.x & 0xffffu, v.x >> 16u, v.y & 0xffffu);
}

// a + b of two (low word, carries) accumulators, exactly.
fn merge(a: vec2<u32>, b: vec2<u32>) -> vec2<u32> {
    let low = a.x + b.x;
    return vec2<u32>(low, a.y + b.y + select(0u, 1u, low < a.x));
}

// Per lane, the accumulators of its rows; lane 0 ends with the workgroup's.
var<workgroup> partial: array<array<vec2<u32>, 10>, 64>;

// One workgroup per sum: its 64 lanes take every 64th row, then add their accumulators in a tree.
@compute @workgroup_size(64)
fn main(
    @builtin(workgroup_id) group: vec3<u32>,
    @builtin(num_workgroups) groups: vec3<u32>,
    @builtin(local_invocation_index) lane: u32,
) {
    let index = group.x + group.y * groups.x;
    if index >= params.windows * params.sums {
        return;
    }
    let w = index / params.sums;
    let pair = pairs[index % params.sums];
    let first = (w * params.vectors + pair.x) * params.rows;
    let second = (w * params.vectors + pair.y) * params.rows;
    // acc[sign * 5 + k]: low word and carries of the products at weight 2^(16 k).
    var acc: array<vec2<u32>, 10>;
    for (var row = lane; row < params.rows; row += 64u) {
        let a = data[first + row];
        let b = data[second + row];
        let base = select(0u, 5u, ((a.y ^ b.y) >> 31u) == 1u);
        let x = limbs(a);
        let y = limbs(b);
        for (var i = 0u; i < 3u; i++) {
            for (var j = 0u; j < 3u; j++) {
                let k = base + i + j;
                acc[k] = merge(acc[k], vec2<u32>(x[i] * y[j], 0u));
            }
        }
    }
    partial[lane] = acc;
    workgroupBarrier();
    for (var stride = 32u; stride > 0u; stride >>= 1u) {
        if lane < stride {
            for (var k = 0u; k < 10u; k++) {
                partial[lane][k] = merge(partial[lane][k], partial[lane + stride][k]);
            }
        }
        workgroupBarrier();
    }
    if lane == 0u {
        for (var k = 0u; k < 10u; k++) {
            sums[index * 20u + 2u * k] = partial[0][k].x;
            sums[index * 20u + 2u * k + 1u] = partial[0][k].y;
        }
    }
}
