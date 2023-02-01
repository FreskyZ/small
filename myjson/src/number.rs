
#[derive(Eq, PartialEq)]
pub struct Number {
    is_positive: bool,
    coef: String,
    is_expo_positive: bool,
    expo: String,
}

impl Number {

    fn new() -> Number {
        Number {
            is_positive: true,
            coef: String::new(),
            is_expo_positive: true,
            expo: String::new(),
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        None
    }

    pub fn as_u64(&self) -> Option<u64> {
        None
    }

    pub fn as_i64(&self) -> Option<i64> {
        None
    }

    pub fn format(&self) -> String {

        let mut ret_val = String::new();

        // leading `-`
        if !self.is_positive {
            ret_val.push_str("-");
        }
        
        // a.bcdefghi
        match self.coef.len() {
            0 => ret_val.push_str("0"),
            1 => ret_val.push_str(&self.coef),
            _ => ret_val.push_str(&format!("{}.{}", &self.coef[0..1], &self.coef[1..])),
        }

        match self.expo.len() {
            0 => ret_val,
            _ => {
                ret_val.push_str("E");
                if !self.is_expo_positive {
                    ret_val.push_str("-");
                }
                ret_val.push_str(&self.expo);
                ret_val
            }
        }
    }
    pub fn len(&self) -> usize {
        self.format().len()
    }
}

use std::fmt;
impl fmt::Debug for Number {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.format())
    }
}

display_by_debug!(Number);

macro_rules! temp_impl {
    ($t: ty) => (
        impl From<$t> for Number {
            fn from(val: $t) -> Number {
                Number::new()
            }
        }
    )
}

temp_impl!(i32);
temp_impl!(i64);
temp_impl!(u64);
temp_impl!(f64);