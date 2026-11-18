//! Small deterministic PCG32 RNG (numpy's generator is not reproducible in Rust).

pub struct Rng {
    state: u64,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        let mut r = Rng { state: 0 };
        r.next_u32();
        r.state = r.state.wrapping_add(seed);
        r.next_u32();
        r
    }

    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        xorshifted.rotate_right(rot)
    }

    /// Uniform in [0, 1).
    pub fn f32(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 / (1u32 << 24) as f32
    }

    /// Uniform integer in [0, n).
    pub fn below(&mut self, n: usize) -> usize {
        ((self.next_u32() as u64 * n as u64) >> 32) as usize
    }

    pub fn shuffle<T>(&mut self, v: &mut [T]) {
        for i in (1..v.len()).rev() {
            let j = self.below(i + 1);
            v.swap(i, j);
        }
    }

    pub fn uniform(&mut self, a: f64, b: f64) -> f64 { a + (b - a) * self.f32() as f64 }

    /// Normal(mean, sd) by Box-Muller.
    pub fn normal(&mut self, mean: f64, sd: f64) -> f64 {
        let u1 = (self.f32() as f64).max(1e-9);
        let u2 = self.f32() as f64;
        mean + sd * (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
    }

    pub fn sign(&mut self) -> f64 { if self.next_u32() & 1 == 0 { 1.0 } else { -1.0 } }
}
