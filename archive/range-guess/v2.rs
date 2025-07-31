// v2: use rust, fix edge case errors and make it 100% correct for game size 1024

mod game {

    use std::cell::{Cell, RefCell};
    use std::fmt;
    use std::ops::Range;
    use rand::random;
    
    pub struct Game {
        a: f64,
        b: f64,
        c: f64,
        x_position: usize,
        y_position: usize,
        data: RefCell<Vec<u8>>,
        count: Cell<usize>,
    }
    
    impl Game {
    
        pub fn new(size: usize) -> Self {
    
            let a = random::<f64>() * 10000.0;
            let b = random::<f64>() * 10000.0;
            let c = random::<f64>() * 10000.0;
            assert!(a != -b, "a == -b, when will this happen?");
    
            let x_position = random::<usize>() % (size - 8);
            let y_position = x_position + 4 + random::<usize>() % (size - 8 - x_position);
            Self { a, b, c, x_position, y_position, data: RefCell::new(vec![0; size]), count: Cell::new(0) }
        }
        pub fn with_positions(size: usize, x_position: usize, y_position: usize) -> Self {
            let a = random::<f64>() * 10000.0;
            let b = random::<f64>() * 10000.0;
            let c = random::<f64>() * 10000.0;
            assert!(a != -b, "a == -b, when will this happen?");
    
            assert!(x_position <= y_position - 4, "x_position should be before y_position and no overlap");
            assert!(y_position <= size - 4, "x_position and y_position should be inside size");
            Self { a, b, c, x_position, y_position, data: RefCell::new(vec![0; size]), count: Cell::new(0) }
        }
    
        pub fn size(&self) -> usize {
            self.data.borrow().len()
        }
    
        pub fn apply(&self, range: Range<usize>, fill: u8) -> f64 {
            self.count.set(self.count.get() + 1);
            let mut data = self.data.borrow_mut();
    
            assert!(range.end <= data.len());
            unsafe {
                // SAFETY: asserted before, range must be inside vec
                data.get_mut(range.clone()).unwrap_unchecked().fill(fill);
    
                // SAFETY: length must fit
                let x = i32::from_le_bytes(data[self.x_position..self.x_position + 4].try_into().unwrap_unchecked());
                let y = i32::from_le_bytes(data[self.y_position..self.y_position + 4].try_into().unwrap_unchecked());
    
                let result = self.a * x as f64 + self.b * y as f64 + self.c;
    
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
    
        pub fn check(&self, a: f64, b: f64, c: f64) -> bool {
            (self.a - a).abs() <= 0.00001 && (self.b - b).abs() <= 0.00001 && (self.c - c).abs() <= 0.00001
        }
        pub fn inspect(&self) -> GameInspect {
            GameInspect(self)
        }
        pub fn call_count(&self) -> usize {
            self.count.get()
        }
    }
    
    pub struct GameInspect<'a>(&'a Game);
    
    impl<'a> fmt::Display for GameInspect<'a> {
        fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
            write!(f, "(a = {:.6}, b = {:.6}, c = {:.6}, xp = {}, yp = {}, call = {})", self.0.a, self.0.b, self.0.c, self.0.x_position, self.0.y_position, self.0.count.get())
        }
    }
    
    }
    
    macro_rules! printd {
        // ($($tt:tt)*) => (println!($($tt)*));
        ($($tt:tt)*) => {};
    }
    
    fn resolve(game_size: usize, maybe_position: Option<(usize, usize)>) -> usize {
        let game = if let Some((xp, yp)) = maybe_position { game::Game::with_positions(game_size, xp, yp) } else { game::Game::new(game_size) };
        // println!("{}", game.inspect()); // something is panicking at range.start == range.end, print this first
    
        let c = game.apply(0..game.size(), 0);
        printd!("c = {}", c);
        
        macro_rules! apply {
            (bare, $range:expr, $fill:expr) => {{
                let result = game.apply($range.clone(), $fill);
                printd!("[{},{})=1: {}", $range.start, $range.end, result);
                result
            }};
            // returns result subtracted by c
            (subc, $range:expr) => (apply!(bare, $range, 1) - c);
            // use to check this is plain, return bool
            (isplain, $range:expr) => (apply!(bare, $range, 1) - c == 0.0);
        }
    
        let find_single = |mut left: usize, mut right: usize, _variable_name: &'static str| -> f64 {
            loop {
                let middle = (left + right) / 2;
                let apply_result = apply!(subc, left..middle);
                if apply_result != 0.0 {
                    right = middle;
                    if left + 1 == right {
                        printd!("{} found {}", _variable_name, left);
                        return apply_result;
                    }
                } else {
                    left = middle;
                    if left + 1 == right {
                        printd!("{} found {}", _variable_name, left);
                        return apply!(subc, left..left + 1); // the last result is for previous left, need to use new left to apply again
                    }
                }
            }
        };
    
        let mut left = 0;
        let mut right = game.size();
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
            printd!("both side is not c: {},{},{}", left, middle, right);
            break;
        }
    
        let mut a = 0.0;
        let mut b = 0.0;
        if left + 5 == right {
            printd!("exact match pos_x = {}, pos_y = {}", left, left + 4);
            // this do will happen, and happen means they pos_x and pos_y are exactly continuous
            a = apply!(subc, left..left + 1);
            b = apply!(subc, left + 4..left + 5);
    
        // 6 and 7 seems correctly handled by the next next branch, will 8 be similar?
        } else if left + 8 == right {
            printd!("look like exact match [{},{})", left, right);
    
            // this seems exact match, but note that the "right = middle - 3" part make pos_y's actual range may fall out of right (dangling)
            // so pos_x may be at left + 1, pos_y at left + 6, etc. simply search from left to right first a then b
            let mut pos_x = 0;
            for i in 0..4 {
                let apply_result = apply!(subc, left + i..left + i + 1);
                if apply_result != 0.0 {
                    a = apply_result;
                    pos_x = left + i;
                    printd!("pos_x = {}", pos_x);
                    break;
                }
            }
            for i in 0..4 {
                let apply_result = apply!(subc, pos_x + 4 + i..pos_x + 5 + i);
                if apply_result != 0.0 {
                    b = apply_result;
                    printd!("pos_y = {}", pos_x + 4 + i);
                    break;
                }
            }
        } else {
            // note that s and t does not overlap, so at most one of them is cross border
            if apply!(isplain, left..middle - 3) {
                printd!("pos_x at border, pos_y at right");
                let mut pos_x = 0;
                for i in [0, 1, 2] {
                    let apply_result = apply!(subc, middle - 3 + i..middle - 2 + i);
                    if apply_result != 0.0 {
                        a = apply_result;
                        pos_x = middle - 3 + i;
                        printd!("pos_x = {}", pos_x);
                        break;
                    }
                }
                b = find_single(pos_x + 4, right, "pos_y");
            } else if apply!(isplain, middle + 3..right) {
                printd!("pos_x at left, pos_y at border");
                let mut pos_y = 0;
                // if pos_x is also very close to border,
                // check middle-3 first (like previous branch) may be actually is affected by pos_x not pos_y
                // should check in reverse order
                // note that search range is also not same, e.g. pos_y at middle-2, apply middle-1 still affect result, so need to search this range
                for i in 0..4 {
                    let apply_result = apply!(subc, middle + 3 - i..middle + 4 - i);
                    if apply_result != 0.0 {
                        // in this case, y = 0x01_00_00_00, device by this is exactly b
                        // b = apply_result / 0x01_00_00_00 as f64;
                        // // and apply again to find actual b
                        b = apply!(subc, middle - i..middle + 1 - i);
                        pos_y = middle - i;
                        printd!("pos_y = {}", pos_y);
                        break;
                    }
                }
                a = find_single(left, pos_y - 3, "pos_x");
            } else {
                printd!("pos_x and pos_y in their own range [{},{}) and [{},{})", left, middle-3, middle, right);
                a = find_single(left, middle - 3, "pos_x");
                b = find_single(middle, right, "pos_y");
            }
        }
    
        // println!("{}: (a = {:.6}, b = {:.6}, c = {:.6})\n    {}", if game.check(a, b, c) { "AC" } else { "WA" }, a, b, c, game.inspect());
        if !game.check(a, b, c) { panic!("panic"); }
        game.call_count()
    }
    
    fn main() {
    
        // // error cases
        // resolve(1024, Some((695, 700)));
        // resolve(1024, Some((885, 892)));
        // resolve(1024, Some((960, 973)));
        // resolve(1024, Some((981, 991)));
        // resolve(1024, Some((1010, 1015)));
        // resolve(1024, Some((1003, 1007)));
        // resolve(1024, Some((965, 990)));
        // resolve(1024, Some((626, 765)));
        // resolve(1024, Some((1008, 1012)));
    
        // // random position
        // const COUNT: usize = 100000;
        // const GAMESIZE: usize = 1024;
        // let mut total_call = 0;
        // for _ in 0..COUNT {
        //     total_call += resolve(GAMESIZE, None);
        // }
        // println!("avg call count {}", total_call as f64 / COUNT as f64);
    
        // but actually you can iterate through all position
        let mut call_count = 0;
        let mut resolve_count = 0;
        for xp in 0..1016 {
            for yp in xp+4..1020 {
                resolve_count += 1;
                call_count += resolve(1024, Some((xp, yp)));
            }
        }
        // real avg 23.320670646257714 (516636 runs)
        // real avg 23.30471937689205 (516636 runs)
        println!("real avg {} ({} runs)", call_count as f64 / resolve_count as f64, resolve_count);
    }
    