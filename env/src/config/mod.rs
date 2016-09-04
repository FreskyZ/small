extern crate xml;

use std::fs::File;
// https://github.com/netvl/xml-rs
use self::xml::reader::{ EventReader as XmlReader, XmlEvent };

mod config_error;
mod parsed_element;
mod target;

use self::parsed_element::ParsedElement;
pub use self::config_error::ConfigError;
pub use self::target::Target;

fn get_target_name_by_path(path: &Vec<&str>, parser: &mut XmlReader<File>, require_list: bool) -> Result<String, ConfigError> {

    // Expecting path at index
    enum State<'a> {
        Expecting(usize, Option<&'a str>),
        Recording(usize, Vec<String>),
    }

    let mut in_paths = false;
    let mut path_iter = path.into_iter();
    let mut depth = 0_usize;
    let mut state = State::Expecting(depth, path_iter.next().map(|p| *p));
    let indent = ["  ", "    ", "      ", "        ", "          ", "            "];
    loop {
        match parser.next() {
            Ok(XmlEvent::StartElement { ref name, ref attributes, .. }) => {
                match ParsedElement::from(name, attributes) {
                    ParsedElement::Paths => {
                        perrorln!("Paths started");
                        in_paths = true;
                    },
                    ParsedElement::PathNode { ref inner } if in_paths => {
                        perrorln!("{}{:?}", indent[depth], inner);

                        match state {
                            State::Expecting(expected_depth, expected_value) => {
                                perror!("{}expecting {:?} @ {}, ", indent[depth], expected_value, expected_depth);

                                if depth == expected_depth && inner.has(expected_value.unwrap_or("(Iter ended)")) {
                                    match path_iter.next().map(|p| *p) {
                                        Some(next) => {
                                            perrorln!("found, move forward");
                                            state = State::Expecting(expected_depth + 1, Some(next));
                                        },
                                        None => {
                                            if require_list {
                                                perrorln!("{}Require listing, now recording", indent[depth]);
                                                state = State::Recording(expected_depth + 1, Vec::new());
                                            } else {
                                                match inner.target {
                                                    Some(target) => { 
                                                        perrorln!("found, target is {:?}\n", target);
                                                        return Ok(target.to_owned());
                                                    }
                                                    None => {
                                                        perrorln!("found, target not set, going to record nexts\n");
                                                        state = State::Recording(expected_depth + 1, Vec::new()); 
                                                        // return Err(ConfigError::TargetNotSet); 
                                                    }
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    perrorln!("not match, continue");
                                }
                            }
                            State::Recording(expected_depth, ref mut recorded_values) => {
                                if depth > expected_depth {
                                    perrorln!("{}Inner values, not recorded", indent[depth]);
                                    // Ignore, no need to record
                                } else if depth == expected_depth {
                                    perrorln!("{}Recorded these values", indent[depth]);
                                    recorded_values.push(String::new());
                                    for value in &inner.values {
                                        recorded_values.last_mut().unwrap().extend(value.chars());
                                        recorded_values.last_mut().unwrap().extend(", ".to_owned().chars());
                                    }
                                } else if depth < expected_depth {
                                    unreachable!();
                                }
                            }
                        }
                        depth += 1;
                    },
                    _ => ()
                }
            }
            Ok(XmlEvent::EndElement { name }) => {
                match &*name.local_name {
                    "paths" => {
                        perrorln!("Paths end\n");
                    },
                    "p" => {
                        depth -= 1;
                        if let State::Recording(recording_depth, ref recorded_values) = state {
                            if recording_depth - 1 == depth {
                                // Out of recording area, return
                                perrorln!("{}Record should be finished, recorded: {:?}", indent[depth], recorded_values);
                                return Err(ConfigError::TargetNotSet);
                            } 
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

fn get_target_by_name(target_name: &str, parser: &mut XmlReader<File>) -> Result<Target, ConfigError> {

    let mut in_targets = false;
    let mut in_target = false;
    let mut ret_val = Target { actions: Vec::new() };

    loop {
        match parser.next() {
            Ok(XmlEvent::StartElement { ref name, ref attributes, .. }) => {
                match ParsedElement::from(name, attributes) {
                    ParsedElement::Targets => {
                        // perrorln!("Targets started");
                        in_targets = true;
                    },
                    ParsedElement::TargetNode { name } if in_targets => {
                        match name {
                            Some(name) if name == target_name => {
                                in_target = true;
                                // perrorln!("in target {}: ", target_name);
                            },
                            _ => ()
                        }
                    },
                    ParsedElement::PathAdd(value) if in_target => {
                        match value {
                            Some(value) => ret_val.push_path(value),
                            None => ()
                        }
                    },
                    ParsedElement::ScriptExecute(value) if in_target => {
                        match value {
                            Some(value) => ret_val.push_script(value),
                            None => ()
                        }
                    }
                    _ => ()
                }
            }
            Ok(XmlEvent::EndElement { name }) => {
                match &*name.local_name {
                    "targets" => {
                        // perrorln!("Targets end\n");
                        break;
                    },
                    "target" if in_target => {
                        // perrorln!("Leaving target");
                        return Ok(ret_val);
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

pub fn get_target(parser: &mut XmlReader<File>, path: Vec<&str>, require_list: bool) -> Result<Target, ConfigError> {
    
    get_target_name_by_path(&path, parser, require_list)
        .and_then(|target_name| get_target_by_name(&*target_name, parser))
}

#[cfg(test)]
mod tests {
    use super::get_target;
    use std::fs::File;

    use super::xml::reader::{ EventReader as XmlReader };

    #[test]
    fn load_xml_file() {

        let file = match File::open(".env") {
            Ok(file) => file,
            Err(e) => panic!("Open file error: {}", e),
        };
        let mut parser = XmlReader::new(file);  

        match get_target(&mut parser, vec!["msvc", "19"], true) {
            Ok(target) => {
                perrorln!("Get target: {:?}", target);
            },
            Err(e) => perrorln!("Error: {}", e),
        }
    }
}