
mod error;
mod result;
mod parser;

pub use self::error::Error;
pub use self::parser::{ ConfigEvent, ConfigParser };
pub use self::result::{ TargetAction, ConfigResult };

// TODO: Big change State
// TODO: Big change Error
// TODO: Result applier
// TODO: Commandline Interface

#[derive(Debug)]
enum State<'a> {
    WaitingPaths,
    SearchingPathNode {
        current_depth: usize,
        expect_depth: usize,    
        expect_value: &'a str,
    },
    RecordingAvailables {
        current_depth: usize,
        expect_depth: usize, 
        ret_val: Vec<String>
    },
    WaitingTargets {
        target_name: &'a str,
    },
    SearchingTarget {
        target_name: &'a str,
    },
}

impl<'a> State<'a> {
    fn new_search_p(current: usize, expect: usize, value: &'a str) -> State<'a> {
        State::SearchingPathNode { 
            current_depth: current,
            expect_depth: expect,
            expect_value: value,
        }
    }

    fn new_record_p(current: usize, expect: usize) -> State<'a> {
        State::RecordingAvailables {
            current_depth: current,
            expect_depth: expect,
            ret_val: Vec::new()
        }
    }
}

// always return next availables when require list
// return target actions if have
// return next availables if not have target
// Errors
// Error::FailOpenFile on fail open file
// Error::FailParse on XMLReader error
// Error::InvalidFormat 
pub fn get_target(file_name: &str, 
    path: &Vec<&str>, require_list: bool) -> Result<ConfigResult, Error> {

    let target_name : String;
    let mut state = State::WaitingPaths;
    
    let mut parser = try!(ConfigParser::from(file_name));
    let mut path_iter = path.into_iter();

    loop {
        match parser.next() {
            Some(ConfigEvent::StartPaths) => {
                match state {
                    State::WaitingPaths => {
                        match path_iter.next().map(|p| *p) {
                            Some(next) => {
                                state = State::new_search_p(0, 0, next);
                            }
                            None => {
                                state = State::new_record_p(0, 0);
                            }
                        }
                    }
                    _ => (),
                }
            },
            Some(ConfigEvent::StartP { depth: _depth, mut inner }) => {
                // perrorln!("{:?}\nstate {:?}", inner, state);
                match state {
                    State::SearchingPathNode { current_depth, expect_depth, expect_value } => {
                        if current_depth == expect_depth && inner.has(expect_value) {
                            match path_iter.next().map(|p| *p) {
                                Some(next) => {
                                    state = State::new_search_p(current_depth + 1, expect_depth + 1, next);
                                },
                                None => {
                                    if require_list {
                                        state = State::new_record_p(current_depth + 1, expect_depth + 1);
                                    } else {
                                        match inner.target {
                                            Some(target) => {
                                                target_name = target.to_owned();
                                                state = State::WaitingTargets { target_name: &*target_name };
                                                break;
                                            }
                                            None => {
                                                state = State::new_record_p(current_depth + 1, expect_depth + 1)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        else {
                            state = State::new_search_p(current_depth + 1, expect_depth, expect_value);
                        }
                    }
                    State::RecordingAvailables { ref mut current_depth, ref expect_depth, ref mut ret_val } => {
                        if *current_depth == *expect_depth { 
                            ret_val.push(inner.to_string());
                        } // else ignore
                        *current_depth += 1;
                    }
                    _ => () // WaitingPaths => <p> not in <paths>, ignore
                }
            },
            Some(ConfigEvent::EndPaths) => {
                match state {
                    State::RecordingAvailables { current_depth: ref _1, expect_depth: ref _2, ref mut ret_val } => {
                        return Ok(ConfigResult::AvailablePathNodes(ret_val.clone()));                                
                    },
                    State::SearchingPathNode { .. } => {
                        return Err(Error::UnexpectedPath);
                    }
                    _ => (),
                }
            },
            Some(ConfigEvent::EndP { depth: _depth }) => {
                // perrorln!("end p\nstate: {:?}", state);
                match state {
                    State::RecordingAvailables { ref mut current_depth, ref expect_depth, ref mut ret_val } => {
                        if *expect_depth == *current_depth {
                            // Out of recording area, return
                            return Ok(ConfigResult::AvailablePathNodes(ret_val.clone()));
                        } 
                        *current_depth -= 1;
                    }
                    State::SearchingPathNode { ref mut current_depth, .. } => {
                        *current_depth -= 1;
                    }
                    _ => (),
                }
            },
            Some(ConfigEvent::XMLReaderError { e }) => {
                return Err(e);
            },
            None => break,
            _ => ()
        }
    }

    loop {
        match parser.next() {
            Some(ConfigEvent::StartTargets) => {
                if let State::WaitingTargets { target_name } = state {
                    state = State::SearchingTarget { target_name: target_name };
                }
            },
            Some(ConfigEvent::Target { name, actions }) => {
                if let State::SearchingTarget { target_name } = state {
                    if name == target_name {
                        return Ok(ConfigResult::Actions(actions));
                    }
                }
            },
            Some(ConfigEvent::EndTargets) => {
                match state {
                    State::WaitingTargets { .. } => {
                        // Err::TargetsNotExist
                        return Err(Error::TargetsNotExist);
                    }
                    State::SearchingTarget { target_name } => {
                        return Err(Error::TargetNotExist { target_name: target_name.to_owned() } );
                    }
                    _ => (),
                }
            },
            Some(ConfigEvent::XMLReaderError { e }) => {
                return Err(e);
            }
            None => break,
            _ => ()
        };
    }
    unreachable!();
}

#[cfg(test)]
mod tests {
    use super::get_target;
    use super::ConfigResult;
    use super::TargetAction::*;
    use super::parser::{ ConfigEvent, ConfigParser };
    use super::error::Error;

    macro_rules! test_case { // =? or =>
        ([$($paths:tt)*], $req: expr, actions: [$($actions:tt)*]) => (
            match get_target(".env", &vec![$($paths)*], $req) {
                Ok(ConfigResult::Actions(actions)) => {
                    assert_eq!(actions, vec![$($actions)*]);
                }
                Ok(_) => unreachable!(),
                Err(e) => panic!("{:?}", e),
            }
        );
        ([$($paths:tt)*], $req: expr, nexts: [$($nexts:tt)*]) => (
            match get_target(".env", &vec![$($paths)*], $req) {
                Ok(ConfigResult::AvailablePathNodes(nexts)) => {
                    assert_eq!(nexts, vec![$($nexts)*]);
                }
                Ok(_) => unreachable!(),
                Err(e) => panic!("{:?}", e),
            }
        )
    }

    #[test]
    fn get_targets() {
        
        test_case!(["msvc", "19"], true, 
            nexts: ["m32(x86)", "m64(amd64, x64)"]);
        test_case!([], true,  
            nexts: ["gcc(gnuc)", "git", "haskell(hs)", "java", "lua", "nasm", 
                ".net(dotnet, netfx, netframework)", "vcpp(msvc)", "python(py)", "rust"]);
        test_case!(["msvc", "19", "amd64"], false, 
            actions: [PathAdd(r"C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\ClangC2\bin\amd64".to_owned()),
                ScriptExecute(r"C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\bin\amd64\vcvars64.bat".to_owned())]);
    }

    #[test]
    fn get_target_error() {

        { // File IO error
            let _ = match ConfigParser::from(".env_some_other") {
                Ok(_) => panic!("File open error not triggered"),
                Err(e @ Error::FailOpenFile { .. }) => perrorln!("Meet expected error: {:?}", e),
                Err(e) => panic!("Unexpected error throwed: {:?}", e),
            };
        }

        { // XML Reader Error
            let parser = ConfigParser::from(".env_xml_error").unwrap();

            let mut meet_expected_error = false;
            for event in parser {
                match event {
                    ConfigEvent::XMLReaderError { e: e @ Error::FailParse { .. } } => { 
                        meet_expected_error = true;
                        perrorln!("Meet expected error: {:?}", e); 
                        break; 
                    }
                    _ => (), 
                }
            }
            if !meet_expected_error {
                panic!("Didn't meet expected error");
            }
        } 

        { // Config parser errors

            fn test_case(file_name: &str) {
                let parser = ConfigParser::from(file_name).unwrap();

                let mut meet_expected_error = false;
                for event in parser {
                    match event {
                        ConfigEvent::XMLReaderError { e: e @ Error::InvalidFormat { .. } } => { 
                            meet_expected_error = true;
                            perrorln!("Meet expected error: {:?}", e); 
                            break; 
                        }
                        _ => (), 
                    }
                }
                if !meet_expected_error {
                    panic!("Didn't meet expected error");
                }
            }

            test_case(".env_to_invalid_in_paths");
            test_case(".env_to_invalid_in_targets");
            test_case(".env_to_invalid_in_target");
        }

        { // Path to target errors 

        }
    }

    #[test]
    fn get_target_f() {
        
        let mut parser = ConfigParser::from(".env").unwrap();

        loop {
            match parser.next() {
                Some(event) => perrorln!("event is {:?}", event),
                None => break,
            }
        }
    }
}