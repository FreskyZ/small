extern crate xml;

use std::fs::File;
// https://github.com/netvl/xml-rs
use self::xml::reader::{ EventReader as XmlReader, XmlEvent };

mod config_error;
mod parsed_element;
mod config_result;

use self::parsed_element::ParsedElement;
pub use self::config_error::ConfigError;
pub use self::config_result:: { TargetAction, ConfigResult };

enum SearchResult {
    Target(String),
    Available(Vec<String>),
}

fn get_target_name_by_path(
    path: &Vec<&str>, 
    parser: &mut XmlReader<File>, 
    require_list: bool) 
    -> Result<SearchResult, ConfigError> {

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
    }

    let mut path_iter = path.into_iter();
    let mut state = State::WaitingPaths;
    loop {
        match parser.next() {
            Ok(XmlEvent::StartElement { ref name, ref attributes, .. }) => {
                match ParsedElement::from(name, attributes) {
                    ParsedElement::Paths => {
                        match state {
                            State::WaitingPaths => {
                                match path_iter.next().map(|p| *p) {
                                    Some(next) => {
                                        state = State::SearchingPathNode {
                                            current_depth: 0_usize,
                                            expect_depth: 0_usize, 
                                            expect_value: next 
                                        };
                                    }
                                    None => {
                                        state = State::RecordingAvailables {
                                            current_depth: 0_usize,
                                            expect_depth: 0_usize,
                                            ret_val: Vec::new()
                                        };
                                    }
                                }
                            }
                            _ => (),
                        }
                    },
                    ParsedElement::PathNode { inner } => {
                        // perrorln!("{:?}\nstate {:?}", inner, state);
                        match state {
                            State::SearchingPathNode { current_depth, expect_depth, expect_value } => {
                                if current_depth == expect_depth && inner.has(expect_value) {
                                    match path_iter.next().map(|p| *p) {
                                        Some(next) => {
                                            state = State::SearchingPathNode { 
                                                current_depth: current_depth + 1,
                                                expect_depth: expect_depth + 1, 
                                                expect_value: next 
                                            };
                                        },
                                        None => {
                                            if require_list {
                                                state = State::RecordingAvailables {
                                                    current_depth: current_depth + 1,
                                                    expect_depth: expect_depth + 1,
                                                    ret_val: Vec::new()
                                                };
                                            } else {
                                                match inner.target {
                                                    Some(target) => { 
                                                        return Ok(SearchResult::Target(target.to_owned()));
                                                    }
                                                    None => {
                                                        state = State::RecordingAvailables {
                                                            current_depth: current_depth + 1,
                                                            expect_depth: expect_depth + 1,
                                                            ret_val: Vec::new()
                                                        };
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                else {
                                    state = State::SearchingPathNode {
                                        current_depth: current_depth + 1,
                                        expect_depth: expect_depth,
                                        expect_value: expect_value,
                                    };
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
                    _ => () // Other start element, ignore
                }
            }
            Ok(XmlEvent::EndElement { name }) => {
                match &*name.local_name {
                    "paths" => {
                        match state {
                            State::RecordingAvailables { current_depth: ref _1, expect_depth: ref _2, ref mut ret_val } => {
                                return Ok(SearchResult::Available(ret_val.clone()));                                
                            },
                            State::SearchingPathNode { .. } => {
                                return Err(ConfigError::UnexpectedPath);
                            }
                            _ => (),
                        }
                    },
                    "p" => {
                        // perrorln!("end p\nstate: {:?}", state);
                        match state {
                            State::RecordingAvailables { ref mut current_depth, ref expect_depth, ref mut ret_val } => {
                                if *expect_depth == *current_depth {
                                    // Out of recording area, return
                                    return Ok(SearchResult::Available(ret_val.clone()));
                                } 
                                *current_depth -= 1;
                            }
                            State::SearchingPathNode { ref mut current_depth, .. } => {
                                *current_depth -= 1;
                            }
                            _ => (),
                        }
                    },
                    _ => ()
                }
            }
            Err(e) => {
                return Err(ConfigError::FailParse { inner_error: e })
            }
            Ok(XmlEvent::EndDocument) => {
                break;
            }
            _ => ()
        };
    }

    Err(ConfigError::UnexpectedPath)
}

fn get_target_by_name(target_name: &str, parser: &mut XmlReader<File>) -> Result<ConfigResult, ConfigError> {

    enum State<'a> {
        WaitingTargets {
            target_name: &'a str,
        },
        SearchingTarget {
            target_name: &'a str,
        },
        RecordingTargetActions {
            ret_val: Vec<TargetAction>,
        }
    }

    let mut state = State::WaitingTargets { target_name: target_name };

    loop {
        match parser.next() {
            Ok(XmlEvent::StartElement { ref name, ref attributes, .. }) => {
                match ParsedElement::from(name, attributes) {
                    ParsedElement::Targets => {
                        match state {
                            State::WaitingTargets { target_name } => {
                                state = State::SearchingTarget { target_name: target_name };
                            }
                            _ => ()
                        }
                    },
                    ParsedElement::TargetNode { name } => {
                        match state {
                            State::SearchingTarget { target_name } => {
                                match name {
                                    Some(name) if name == target_name => {
                                        state = State::RecordingTargetActions { ret_val: Vec::new() };
                                    },
                                    _ => ()
                                }
                            }
                            _ => ()
                        }
                    },
                    ParsedElement::PathAdd(value) => {
                        match state {
                            State::RecordingTargetActions { ref mut ret_val } => {
                                match value {
                                    Some(value) => ret_val.push(TargetAction::PathAdd(value.to_owned())),
                                    None => ()
                                }
                            }
                            _ => ()
                        }
                    },
                    ParsedElement::ScriptExecute(value) => {
                        match state {
                            State::RecordingTargetActions { ref mut ret_val } => {
                                match value {
                                    Some(value) => ret_val.push(TargetAction::ScriptExecute(value.to_owned())),
                                    None => ()
                                }
                            }
                            _ => ()
                        }
                    }
                    _ => ()
                }
            }
            Ok(XmlEvent::EndElement { name }) => {
                match &*name.local_name {
                    "targets" => {
                        match state {
                            State::WaitingTargets { .. } => {
                                // Err::TargetsNotExist
                                return Err(ConfigError::TargetsNotExist);
                            }
                            State::SearchingTarget { .. } => {
                                return Err(ConfigError::TargetNotExist { target_name: target_name.to_owned() } );
                            }
                            State::RecordingTargetActions { .. } => {
                                // an entire <targets> in <target>, ignore
                            }
                        }
                    },
                    "target" => {
                        match state {
                            State::WaitingTargets { .. } => {
                                // <target> outside of <targets>, ignore
                            }
                            State::SearchingTarget { .. } => {
                                // normal search match fail, ignore
                            }
                            State::RecordingTargetActions { ret_val } => {
                                return Ok(ConfigResult::Actions(ret_val));
                            }
                        }
                    }
                    _ => ()
                }
            }
            Err(e) => {
                return Err(ConfigError::FailParse { inner_error: e })
            }
            Ok(XmlEvent::EndDocument) => {
                break;
            }
            _ => ()
        };
    }
    
    Err(ConfigError::TargetNotExist { target_name: target_name.to_owned() })
}

pub fn get_target(
    parser: &mut XmlReader<File>, 
    path: Vec<&str>, 
    require_list: bool) 
    -> Result<ConfigResult, ConfigError> {
    
    match get_target_name_by_path(&path, parser, require_list) {
        Ok(target_name) => {
            match target_name {
                SearchResult::Available(availables) => {
                    return Ok(ConfigResult::AvailablePathNodes(availables)); 
                },
                SearchResult::Target(target_name) => {
                    return get_target_by_name(&*target_name, parser);
                }
            };
        },
        Err(e) => return Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::get_target;
    use std::fs::File;

    use super::xml::reader::{ EventReader as XmlReader };
    use super::ConfigResult;
    use super::TargetAction;

    #[test]
    fn get_target_availables() {

        let file = match File::open(".env") {
            Ok(file) => file,
            Err(e) => panic!("Open file error: {}", e),
        };
        let mut parser = XmlReader::new(file);  

        match get_target(&mut parser, vec!["msvc", "19"], true) {
            Ok(ConfigResult::Actions(_)) => unreachable!(),
            Ok(ConfigResult::AvailablePathNodes(nexts)) => assert_eq!(nexts, ["x86", "amd64(x64)"]),
            Err(e) => panic!("{}", e), 
        }
    }
    
    #[test]
    fn get_target_targets() {

        let file = match File::open(".env") {
            Ok(file) => file,
            Err(e) => panic!("Open file error: {}", e),
        };
        let mut parser = XmlReader::new(file);  

        match get_target(&mut parser, vec!["msvc", "19", "amd64"], false) {
            Ok(ConfigResult::Actions(actions)) => assert_eq!(actions,
                [TargetAction::ScriptExecute("script for cl64".to_owned()), 
                TargetAction::PathAdd("path add value for cl64".to_owned()), 
                TargetAction::ScriptExecute("another script for cl64".to_owned())]),
            Ok(ConfigResult::AvailablePathNodes(_)) => unreachable!(),
            Err(e) => panic!("{}", e), 
        }
    }

    #[test]
    fn get_target_empty_input() {
        
        let file = match File::open(".env") {
            Ok(file) => file,
            Err(e) => panic!("Open file error: {}", e),
        };
        let mut parser = XmlReader::new(file);  

        match get_target(&mut parser, vec![], true) {
            Ok(ConfigResult::Actions(_)) => unreachable!(),
            Ok(ConfigResult::AvailablePathNodes(nexts)) => assert_eq!(nexts, ["gcc(gnuc)", "vcpp(msvc)", "git", "python(py)", ""]),
            Err(e) => panic!("{}", e), 
        }
    }
}