
#[derive(Debug, Eq, PartialEq)]
pub enum InputType {
    Help,
    Version,
    OpenConfig,
    GetInfo { path: String, require_list: bool },
    Paths { paths: Vec<String> },
}

enum SpecialOrNormal<'a> {
    Special(InputType),
    Normal(&'a str),
}

// Try convert to InputType
fn try_to_spec<'a>(arg: &'a str) -> SpecialOrNormal<'a> {
    match arg {
        "--help" | "-h" => SpecialOrNormal::Special(InputType::Help),
        "--open-config" | "-c" => SpecialOrNormal::Special(InputType::OpenConfig),
        "--version" | "-v" => SpecialOrNormal::Special(InputType::Version),
        other => {
            if other.starts_with("--list:") {
                return SpecialOrNormal::Special(InputType::GetInfo { path: other.split_at(7).1.to_owned(), require_list: true });
            } else if other.starts_with("-l") {
                return SpecialOrNormal::Special(InputType::GetInfo { path: other.split_at(2).1.to_owned(), require_list: true });
            } else if other.starts_with("--target:") {
                return SpecialOrNormal::Special(InputType::GetInfo { path: other.split_at(9).1.to_owned(), require_list: false });
            } else if other.starts_with("-t") {
                return SpecialOrNormal::Special(InputType::GetInfo { path: other.split_at(2).1.to_owned(), require_list: false });
            }
            SpecialOrNormal::Normal(other)
        }
    }
}

use std::iter::FromIterator;
use std::fmt::Display;
use error::Error;
impl InputType {

    pub fn get<T>(args: T) -> Result<InputType, Error> 
        where T : ExactSizeIterator,
              <T as Iterator>::Item: AsRef<str> + Display,
              Vec<String>: FromIterator<<T as Iterator>::Item>, {

        match args.len() {
            1 => Ok(InputType::Help),
            2 => {
                let arg1 = &*args.last().unwrap().as_ref().to_lowercase();
                match try_to_spec(arg1) {
                    SpecialOrNormal::Special(spec) => Ok(spec),
                    SpecialOrNormal::Normal(normal) => Ok(InputType::Paths { paths: vec![normal.to_owned()] }),
                }
            }
            _ => {
                let mut ret_val = Vec::new();
                for arg in args.skip(1) {
                    match try_to_spec(arg.as_ref()) {
                        SpecialOrNormal::Special(_) => return Err(Error::InvalidArgument { arg: arg.to_string() }),
                        SpecialOrNormal::Normal(_) => {
                            ret_val.push(arg.to_string());
                        }
                    }
                }
                Ok(InputType::Paths { paths: ret_val })
            }
        }
    }
}

#[cfg(test)]
#[test]
fn input_type_get() {

    macro_rules! test_case {
        ([$($args:tt)*] => $expect: expr) => (
            match InputType::get(vec!["env.exe", $($args)*].into_iter().map(|arg| arg.to_owned()).into_iter()) {
                Ok(ret_val) => assert_eq!(ret_val, $expect),
                Err(e) => panic!("unexpected error: {}", e),
            }
        );
        ([$($args:tt)*] => list $expect: expr) => (
            test_case!([$($args)*] => InputType::GetInfo { path: $expect.to_owned(), require_list: true });
        );
        ([$($args:tt)*] => target $expect: expr) => (
            test_case!([$($args)*] => InputType::GetInfo { path: $expect.to_owned(), require_list: false });
        );
        ([$($args:tt)*] => paths $($expects:tt)*) => (
            test_case!([$($args)*] => InputType::Paths { paths: vec![$($expects)*].into_iter().map(|arg| arg.to_owned()).into_iter().collect() });
        );

        ([$($args:tt)*] => error $invalid_arg: expr) => (
            match InputType::get(vec!["env.exe", $($args)*].into_iter().map(|arg| arg.to_owned()).into_iter()) {
                Ok(ret_val) => panic!("Unexpected success: {:?}", ret_val),
                Err(Error::InvalidArgument { arg }) => assert_eq!(arg, $invalid_arg),
                Err(e) => panic!("Unexpected other error: {}", e)
            }
        );
    }
    
    test_case!([] => InputType::Help);
    test_case!(["--version"] => InputType::Version);
    test_case!(["-v"] => InputType::Version);
    test_case!(["--open-config"] => InputType::OpenConfig);
    test_case!(["--list:123"] => list "123");
    test_case!(["-l456"] => list "456");
    test_case!(["--target:789"] => target "789");
    test_case!(["asdasd", "qwedw"] => paths "asdasd", "qwedw");
    test_case!(["asdwefdw"] => paths "asdwefdw");
    test_case!(["aed", "--list:Qwde"] => error "--list:Qwde");
    test_case!(["aed", "asdwef", "-tfwse", "asdwe"] => error "-tfwse");
}