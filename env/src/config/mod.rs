
mod error;
mod result;
mod parser;

use self::parser::{ ConfigEvent, ConfigParser };
use self::parser::xml::common::TextPosition;

pub use self::error::Error;
pub use self::result::{ TargetAction, ConfigResult };

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
        ret_val: Vec<String>,
    },
    ErrorRecordingAvailables {
        current_depth: usize,
        expect_depth: usize,
        ret_val: Vec<String>,
    },
    WaitingTargets {
        target_name: &'a str,
        target_config_pos: TextPosition,
    },
    SearchingTarget {
        target_name: &'a str,
        target_config_pos: TextPosition,
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

    fn new_error_record_p(current: usize, expect: usize) -> State<'a> {
        State::ErrorRecordingAvailables {
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
pub fn get_target(file_name: &str, full_path: &str, require_list: bool) -> Result<ConfigResult, Error> {

    let target_name : String;
    let mut parser = try!(ConfigParser::from(file_name));

    let path = &{
        if full_path.is_empty() {
            Vec::<&str>::new()
        } else {
            let splitted = full_path.split('/').collect::<Vec<&str>>();
                
            let mut valid = true;
            for i in 0..splitted.len() {
                if splitted[i] == "" {
                    valid = false;
                }
            }

            if valid {
                splitted
            } else {
                return Err(Error::InvalidPath { path: full_path.to_owned() });
            }
        }
    };
    
    let mut state = State::WaitingPaths;
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
                                                state = State::WaitingTargets { 
                                                    target_name: &*target_name,
                                                    target_config_pos: parser.position(), 
                                                };
                                                break;
                                            }
                                            None => {
                                                state = State::new_error_record_p(current_depth + 1, expect_depth + 1)
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
                    State::ErrorRecordingAvailables { ref mut current_depth, ref expect_depth, ref mut ret_val } => {
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
                    State::ErrorRecordingAvailables { current_depth: ref _1, expect_depth: ref _2, ref mut ret_val } => {
                        return Err(Error::TargetNotSet{ path: "Dummy".to_owned(), nodes_available: ret_val.clone(), path_node_pos: parser.position() });                                
                    },
                    State::SearchingPathNode { .. } => {
                        return Err(Error::PathNodeNotFound { path: "1".to_owned(), correct_part: "2".to_owned(), incorrect_node: "3".to_owned(), is_invalid: false, nodes_available: Vec::new() });
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
                    State::ErrorRecordingAvailables { ref mut current_depth, ref expect_depth, ref mut ret_val } => {
                        if *expect_depth == *current_depth {
                            // Out of recording area, return
                            return Err(Error::TargetNotSet{ path: "Dummy".to_owned(), nodes_available: ret_val.clone(), path_node_pos: parser.position() });   
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
                if let State::WaitingTargets { target_name, target_config_pos } = state {
                    state = State::SearchingTarget { target_name: target_name, target_config_pos: target_config_pos };
                }
            },
            Some(ConfigEvent::Target { name, actions }) => {
                if let State::SearchingTarget { target_name, .. } = state {
                    if name == target_name {
                        return Ok(ConfigResult::Actions(actions));
                    }
                }
            },
            Some(ConfigEvent::EndTargets) => {
                match state {
                    State::WaitingTargets { target_name, target_config_pos } => {
                        return Err(Error::TargetNotExist { path: "Dummy".to_owned(), target_name: target_name.to_owned(), target_config_pos: target_config_pos });
                    }
                    State::SearchingTarget { target_name, target_config_pos } => {
                        return Err(Error::TargetNotExist { path: "Dummy".to_owned(), target_name: target_name.to_owned(), target_config_pos: target_config_pos });
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


    #[test]
    fn get_targets() {
        
        macro_rules! test_case { // =? or =>
            ($full_path: expr, $req: expr, actions: [$($actions:tt)*]) => (
                match get_target(".env", $full_path, $req) {
                    Ok(ConfigResult::Actions(actions)) => {
                        assert_eq!(actions, vec![$($actions)*]);
                    }
                    Ok(_) => unreachable!(),
                    Err(e) => panic!("{:?}", e),
                }
            );
            
            ($full_path: expr, $req: expr, nexts: [$($nexts:tt)*]) => (
                match get_target(".env", $full_path, $req) {
                    Ok(ConfigResult::AvailablePathNodes(nexts)) => {
                        assert_eq!(nexts, vec![$($nexts)*]);
                    }
                    Ok(_) => unreachable!(),
                    Err(e) => panic!("{:?}", e),
                }
            )
        }

        test_case!("msvc/19", true, 
            nexts: ["m32(x86)", "m64(amd64, x64)"]);
        test_case!("", true,
            nexts: ["gcc(gnuc)", "git", "haskell(hs)", "java", "lua", "nasm", 
                ".net(dotnet, netfx, netframework)", "vcpp(msvc)", "python(py)", "rust"]);
        test_case!("msvc/19/amd64", false, 
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

            macro_rules! test_case {
                ($path: expr, $req_list: expr) => (
                    match get_target(".env_for_get_target_error", $path, $req_list) {
                        Ok(_) => panic!("Unexpectedly succeed"),
                        Err(e) => perrorln!("Meet expected error: {}", e),
                    }
                )
            }

            test_case!("abc//asd", false);
            test_case!("balabala", false);
            test_case!("python/450", false);
            test_case!("rust/1.11/MSVC", false);
            test_case!("rust", false);
            test_case!("py/2", false);
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