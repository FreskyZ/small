
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
        expect_depth: usize,    
        expect_value: &'a str,
    },
    RecordingAvailables {
        expect_depth: usize, 
        ret_val: Vec<String>,
    },
    ErrorRecordingAvailables {
        expect_depth: usize,
        ret_val: Vec<String>,
    },
    WaitingTargets {
        target_name: String,
        target_config_pos: TextPosition,
    },
    SearchingTarget {
        target_name: String,
        target_config_pos: TextPosition,
    },
}

impl<'a> State<'a> {

    fn start_paths(self, path_next: Option<&'a str>) -> Self {
        match self {
            State::WaitingPaths => {
                match path_next {
                    Some(next) => State::SearchingPathNode { expect_depth: 0, expect_value: next },
                    None => State::RecordingAvailables { expect_depth: 0, ret_val: Vec::new() }
                }
            },
            _ => self
        }
    }
}

// vec![] for "", error for "...//..."
fn split_path(full_path: &str) -> Result<Vec<&str>, Error> {

    if full_path.is_empty() {
        Ok(Vec::new())
    } else {
        let splitted = full_path.split('/').collect::<Vec<&str>>();
            
        let mut valid = true;
        for i in 0..splitted.len() {
            if splitted[i] == "" {
                valid = false;
            }
        }

        if valid {
            Ok(splitted)
        } else {
            return Err(Error::InvalidPath { path: full_path.to_owned() });
        }
    }
}

pub fn get_target(file_name: &str, full_path: &str, require_list: bool) -> Result<ConfigResult, Error> {

    let mut parser = try!(ConfigParser::from(file_name));
    let path = try!(split_path(full_path));
    
    let mut state = State::WaitingPaths;
    let mut path_iter = path.into_iter();

    loop {
        match parser.next() {
            Some(ConfigEvent::StartPaths) => {
                //perrorln!("StartPaths");
                state = state.start_paths(path_iter.next());
            },
            Some(ConfigEvent::StartP { mut inner }) => {
                //perrorln!("StartP: {:?}\ncurrent_depth: {}, state {:?}", inner, current_depth, state);
                match state {
                    State::SearchingPathNode { expect_depth, expect_value } => {
                        if inner.depth == expect_depth && inner.has(expect_value) {
                            match path_iter.next() {
                                Some(next) => {
                                    state = State::SearchingPathNode { 
                                        expect_depth: expect_depth + 1, 
                                        expect_value: next, 
                                    };
                                },
                                None => {
                                    if require_list {
                                        state = State::RecordingAvailables { 
                                            expect_depth: expect_depth + 1, 
                                            ret_val: Vec::new() 
                                        };
                                    } else {
                                        match inner.target {
                                            Some(target) => {
                                                // target_name = target.to_owned();
                                                state = State::WaitingTargets { 
                                                    target_name: target, // &*target_name,
                                                    target_config_pos: parser.position(), 
                                                };
                                                // break;
                                            }
                                            None => {
                                                state = State::ErrorRecordingAvailables { 
                                                    expect_depth: expect_depth + 1, 
                                                    ret_val: Vec::new() 
                                                };
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    State::RecordingAvailables { ref expect_depth, ref mut ret_val } => {
                        if inner.depth == *expect_depth { 
                            ret_val.push(inner.to_string());
                        }
                    }
                    State::ErrorRecordingAvailables { ref expect_depth, ref mut ret_val } => {
                        if inner.depth == *expect_depth { 
                            ret_val.push(inner.to_string());
                        }
                    }
                    _ => () // WaitingPaths => <p> not in <paths>, ignore
                }
            },
            Some(ConfigEvent::EndP { depth: current_depth }) => {
                //perrorln!("EndP\ncurrent_depth: {}, state: {:?}", current_depth, state);
                match state {
                    State::RecordingAvailables { ref expect_depth, ref mut ret_val } => {
                        if *expect_depth == current_depth + 1 {
                            // Out of recording area, return
                            return Ok(ConfigResult::AvailablePathNodes(ret_val.clone()));
                        }
                    }                    
                    State::ErrorRecordingAvailables {  ref expect_depth, ref mut ret_val } => {
                        if *expect_depth == current_depth + 1 {
                            // Out of recording area, return
                            return Err(Error::TargetNotSet{ path: full_path.to_owned(), nodes_available: ret_val.clone(), path_node_pos: parser.position() });   
                        } 
                    }
                    State::SearchingPathNode { .. } => {
                    }
                    _ => (),
                }
            },
            Some(ConfigEvent::EndPaths) => {
                //perrorln!("EndPaths");
                match state {
                    State::RecordingAvailables { expect_depth: ref _2, ref mut ret_val } => {
                        return Ok(ConfigResult::AvailablePathNodes(ret_val.clone()));                                
                    },
                    State::ErrorRecordingAvailables { expect_depth: ref _2, ref mut ret_val } => {
                        return Err(Error::TargetNotSet{ 
                            path: full_path.to_owned(), 
                            nodes_available: ret_val.clone(), 
                            path_node_pos: parser.position() 
                        });                                
                    },
                    State::SearchingPathNode { expect_depth: ref _1, expect_value: ref _2 } => {
                        return Err(Error::PathNodeNotFound { 
                            path: full_path.to_owned(), 
                            correct_part: "2".to_owned(), 
                            incorrect_node: "3".to_owned(), 
                            is_invalid: false, 
                            nodes_available: Vec::new() 
                        });
                    }
                    _ => (),
                }
            },
            Some(ConfigEvent::StartTargets) => {
                if let State::WaitingTargets { target_name, target_config_pos } = state {
                    state = State::SearchingTarget { target_name: target_name, target_config_pos: target_config_pos };
                }
            },
            Some(ConfigEvent::Target { name, actions }) => {
                match state {
                    State::SearchingTarget { ref target_name, .. } => {
                        if name == *target_name {
                            return Ok(ConfigResult::Actions(actions));
                        }
                    }
                    _ => (),
                }
            },
            Some(ConfigEvent::EndTargets) => {
                match state {
                    State::WaitingTargets { target_name, target_config_pos } => {
                        return Err(Error::TargetNotExist { path: full_path.to_owned(), target_name: target_name.to_owned(), target_config_pos: target_config_pos });
                    }
                    State::SearchingTarget { target_name, target_config_pos } => {
                        return Err(Error::TargetNotExist { path: full_path.to_owned(), target_name: target_name.to_owned(), target_config_pos: target_config_pos });
                    }
                    _ => (),
                }
            },
            Some(ConfigEvent::XMLReaderError { e }) => {
                return Err(e);
            }
            None => break,
        };
    }
    
    Err(Error::UnexpectedInternalEroor)
}

#[cfg(test)]
mod tests {

    #![allow(unused_imports)]

    use super::get_target;
    use super::ConfigResult;
    use super::TargetAction::*;
    use super::parser::{ ConfigEvent, ConfigParser };
    use super::error::Error;

    #[test]
    fn get_targets() {
        
        macro_rules! test_case {
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

        if true { // File IO error
            let _ = match ConfigParser::from(".env_some_other") {
                Ok(_) => panic!("File open error not triggered"),
                Err(e @ Error::FailOpenFile { .. }) => perrorln!("Meet expected error: {:?}", e),
                Err(e) => panic!("Unexpected error throwed: {:?}", e),
            };
        }

        if true { // XML Reader Error
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

        if true { // Config parser errors

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

        if true { // Path to target errors 

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
    #[ignore]
    fn get_target_f() {
        
        let mut parser = ConfigParser::from(".env").unwrap();

        loop {
            match parser.next() {
                Some(event) => perrorln!("{:?}", event),
                None => break,
            }
        }
    }
}