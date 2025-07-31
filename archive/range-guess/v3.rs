// v3: merge to one file, remove random to focus on the search position algorithm

use std::cell::{Cell, RefCell};
use std::fmt;
use std::ops::Range;
use std::thread::available_parallelism;
use rayon::prelude::*;

#[cfg(debug_assertions)]
macro_rules! dprintln {
    ($($tt:tt)*) => (println!($($tt)*));
}
#[cfg(not(debug_assertions))]
macro_rules! dprintln {
    ($($tt:tt)*) => ();
}

struct BlackBox {
    call: Cell<usize>,
    data: RefCell<Vec<u8>>,
    x_position: usize,
    y_position: usize,
}

impl fmt::Display for BlackBox {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "(a = 42, b = 43, c = 44, xp = {}, yp = {}, call = {})", self.x_position, self.y_position, self.call.get())
    }
}

impl BlackBox {

    fn new(size: usize, x_position: usize, y_position: usize) -> Self {
        debug_assert!(x_position <= y_position - 4, "x_position should be before y_position and no overlap");
        debug_assert!(y_position <= size - 4, "x_position and y_position should be inside size");
        Self { x_position, y_position, call: Cell::new(0), data: RefCell::new(vec![0; size]) }
    }

    fn apply(&self, range: Range<usize>, fill: u8) -> i32 {
        self.call.set(self.call.get() + 1);
        let mut data = self.data.borrow_mut();

        debug_assert!(range.end <= data.len());
        unsafe {
            // SAFETY: asserted before, range must be inside vec
            data.get_mut(range.clone()).unwrap_unchecked().fill(fill);

            // SAFETY: length must fit
            let x = i32::from_le_bytes(data[self.x_position..self.x_position + 4].try_into().unwrap_unchecked());
            let y = i32::from_le_bytes(data[self.y_position..self.y_position + 4].try_into().unwrap_unchecked());

            let result = 42 * x + 43 * y + 44;

            // SAFETY: asserted before, range must be inside vec
            data.get_mut(range).unwrap_unchecked().fill(0);
            result
        }

        // the cost of _unchecked is when os throw "illegal hardware instruction" you don't know what happen
        // if let Some(slice) = data.get_mut(range.clone()) {
        //     slice.fill(fill);
        // } else {
        //     panic!("{:?} is out of range of size {}", range, self.size());
        // }
        // let x = i32::from_le_bytes(data[self.x_position..self.x_position + 4].try_into().unwrap());
        // let y = i32::from_le_bytes(data[self.y_position..self.y_position + 4].try_into().unwrap());
        // let result = self.a * x as f64 + self.b * y as f64 + self.c;
        // data.get_mut(range).unwrap().fill(0);
        // result
    }

    fn size(&self) -> usize {
        self.data.borrow().len()
    }
    fn calls(&self) -> usize {
        self.call.get()
    }
    fn check(&self, a: i32, b: i32, c: i32) -> bool {
        a == 42 && b == 43 && c == 44
    }
}

fn resolve(x: BlackBox) -> usize {
    let c = x.apply(0..x.size(), 0);
    dprintln!("c = {}", c);
    
    macro_rules! apply {
        (bare, $range:expr, $fill:expr) => {{
            let result = x.apply($range.clone(), $fill);
            dprintln!("[{},{})=1: {}", $range.start, $range.end, result);
            result
        }};
        // returns result subtracted by c
        (subc, $range:expr) => (apply!(bare, $range, 1) - c);
        // use to check this is plain, return bool
        (isplain, $range:expr) => (apply!(bare, $range, 1) - c == 0);
    }

    let ab = apply!(subc, 0..x.size()) / 0x01_01_01_01;
    dprintln!("a + b = {}", ab);

    let mut left = 0;
    let mut right = x.size();
    let mut middle;
    loop {
        middle = (left + right) / 2;
        if apply!(isplain, left..middle) {
            left = middle;
            continue; // pos_x and pos_y must not be in this range
        }
        if apply!(isplain, middle..right) {
            right = middle - 3;
            continue; // pos_x and pos_y must not be in this range, even include [middle-3, middle)
        }
        dprintln!("both side is not c: {},{},{}", left, middle, right);
        break;
    }

    let mut a = 0;
    let mut b = 0;
    if left + 5 == right {
        dprintln!("exact match pos_x = {}, pos_y = {}", left, left + 4);
        // this do will happen, and happen means they pos_x and pos_y are exactly continuous
        a = apply!(subc, left..left + 1);
        b = ab - a; // apply!(subc, left + 4..left + 5);

    // 6 and 7 seems correctly handled by the next next branch, will 8 be similar?
    } else if left + 8 == right {
        dprintln!("look like exact match [{},{})", left, right);

        // this seems exact match, but note that the "right = middle - 3" part make pos_y's actual range may fall out of right (dangling)
        // so pos_x may be at left + 1, pos_y at left + 6, etc. simply search from left to right first a then b
        for i in 0..4 {
            let apply_result = apply!(subc, left + i..left + i + 1);
            if apply_result != 0 {
                a = apply_result;
                dprintln!("pos_x = {}", left + i);
                break;
            }
        }
        b = ab - a;
    } else {
        // note that s and t does not overlap, so at most one of them is cross border
        if apply!(isplain, left..middle - 3) {
            dprintln!("pos_x at border, pos_y at right");
            for i in [0, 1, 2] {
                let apply_result = apply!(subc, middle - 3 + i..middle - 2 + i);
                if apply_result != 0 {
                    a = apply_result;
                    dprintln!("pos_x = {}", middle - 3 + i);
                    break;
                }
            }
            b = ab - a;
        } else if apply!(isplain, middle + 3..right) {
            dprintln!("pos_x at left, pos_y at border");
            // if pos_x is also very close to border,
            // check middle-3 first (like previous branch) may be actually is affected by pos_x not pos_y
            // should check in reverse order
            // note that search range is also not same, e.g. pos_y at middle-2, apply middle-1 still affect result, so need to search this range
            for i in 0..4 {
                let apply_result = apply!(subc, middle + 3 - i..middle + 4 - i);
                if apply_result != 0 {
                    // in this case, y = 0x01_00_00_00, device by this is exactly b
                    b = apply_result / 0x01_00_00_00;
                    dprintln!("pos_y = {}", middle - i);
                    break;
                }
            }
            a = ab - b;
        } else {
            dprintln!("pos_x and pos_y in their own range [{},{}) and [{},{})", left, middle-3, middle, right);
            right = middle - 3;

            let mut apply_results = Vec::new();
            'outermost: loop {
                let middle = (left + right) / 2;
                let apply_result = apply!(subc, left..middle);

                // this is major entry for most of the cases, so use
                // additional branch, the results must be one of [1, 0x101, 0x10101, 0x1010101] ratio
                for &previous_result in apply_results.iter().filter(|&&p| p != apply_result) {
                    let (min, max) = (i32::min(previous_result, apply_result), i32::max(previous_result, apply_result));
                    for [minratio, maxratio] in [
                        [1, 0x101],
                        [1, 0x10101],
                        [1, 0x1010101],
                        [0x101, 0x10101],
                        [0x101, 0x1010101],
                        [0x10101, 0x1010101],
                    ] {
                        if max * minratio == min * maxratio {
                            a = max / maxratio;
                            break 'outermost;
                        }
                    }
                }
                if !apply_results.contains(&apply_result) {
                    apply_results.push(apply_result);
                }

                if apply_result != 0 {
                    right = middle;
                    if left + 1 == right {
                        dprintln!("pos_x found {}", left);
                        a = apply_result;
                        break;
                    }
                } else {
                    left = middle;
                    if left + 1 == right {
                        dprintln!("pos_x found {}", left);
                        a = apply!(subc, left..left + 1); // the last result is for previous left, need to use new left to apply again
                        break;
                    }
                }
            }
            b = ab - a;
        }
    }

    if !x.check(a, b, c) { panic!("incorrect result ({},{})", x.x_position, x.y_position); }
    x.calls()
}

fn main() {

    resolve(BlackBox::new(1024, 0, 4));

    let size = 16384;
    let parallelism = available_parallelism().unwrap().get();
    let (total_resolve_count, total_call_count) = (0..parallelism).into_par_iter().map(|t| {
        let mut call_count = 0;
        let mut resolve_count = 0usize;
        for xp in (size - 8) / parallelism * t..if t == parallelism - 1 { size - 8 } else { (size - 8) / parallelism * (t + 1) } {
            for yp in xp + 4..size - 4 {
                resolve_count += 1;
                call_count += resolve(BlackBox::new(size, xp, yp));
            }
        }
        (resolve_count, call_count)
    }).collect::<Vec<_>>().into_iter().fold((0, 0), |acc, c| (acc.0 + c.0, acc.1 + c.1));

    // 16: avg call 10.3333333333 (36 runs)
    // 512: avg call 21.2018859029 (127260 runs)
    // 1024: avg call 23.3047193769 (12040057/516636)
    // 2048: avg call 25.3760065712 (52828278/2081820)
    // 4096: avg call 27.4232541940 (8357916 runs)
    // 8192: avg call 29.4534835318 (33493020 runs)
    // 16384: avg call 31.4722917750 (134094876 runs)
    // use a + b:
    // 1024: avg call 15.7446867814 (8134272/516636)
    // use apply_results:
    // 1024: avg call 13.3238508350 (6883581/516636)
    // 16384: avg call 17.0599574364 (2287652877/134094876)
    println!("avg call {:.10} ({}/{})", total_call_count as f64 / total_resolve_count as f64, total_call_count, total_resolve_count);
}
