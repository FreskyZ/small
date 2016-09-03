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

fn get_target_name_by_path(path: &Vec<&str>, parser: &mut XmlReader<File>) -> Result<String, ConfigError> {

    // Expecting path at index
    struct Expecting<'a>(usize, Option<&'a str>);

    let mut in_paths = false;
    let mut path_iter = path.into_iter();
    let mut depth = 0_usize;
    let mut state = Expecting(depth, path_iter.next().map(|p| *p));
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
                        perror!("{}expecting {:?} @ {}, ", indent[depth], state.1, state.0);

                        if depth == state.0 && inner.has(state.1.unwrap_or("(Iter ended)")) {
                            match path_iter.next().map(|p| *p) {
                                Some(next) => {
                                    perrorln!("found, move forward");
                                    state = Expecting(state.0 + 1, Some(next));
                                },
                                None => {
                                    match inner.target {
                                        Some(target) => { 
                                            perrorln!("found, target is {:?}", target);
                                            return Ok(target.to_owned()); 
                                        }
                                        None => {
                                            perrorln!("found, target not set"); 
                                            return Err(ConfigError::TargetNotSet); 
                                        }
                                    }
                                }
                            }
                        } else {
                            perrorln!("not match, continue");
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
                        break;
                    },
                    "p" => {
                        depth -= 1;
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
                        // perrorln!("   pathadd: {:?}", value.unwrap_or("(Not set)"));
                    },
                    ParsedElement::ScriptExecute(value) if in_target => {
                        match value {
                            Some(value) => ret_val.push_script(value),
                            None => ()
                        }
                        // perrorln!("   scriptexec: {:?}", value.unwrap_or("(Not set)"));
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

pub fn get_target(path: Vec<&str>) -> Result<Target, ConfigError> {
    
    let file = try!(File::open(".env")
        .map_err(|e| ConfigError::FailOpenFile { inner_error: e }));
    let mut parser = XmlReader::new(file);

    get_target_name_by_path(&path, &mut parser)
        .and_then(|target_name| get_target_by_name(&*target_name, &mut parser))
}

#[cfg(test)]
mod tests {
    use super::get_target;

    #[test]
    fn load_xml_file() {
        match get_target(vec!["vcpp", "19", "amd64"]) {
            Ok(target) => {
                perrorln!("Get target: {:?}", target);
            },
            Err(e) => perrorln!("Error: {}", e),
        }
    }
}