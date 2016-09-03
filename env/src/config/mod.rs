extern crate xml;

use std::fs::File;

// https://github.com/netvl/xml-rs
use self::xml::reader::{ EventReader as XmlReader, XmlEvent };
use self::xml::attribute::OwnedAttribute;

mod target;
mod config_error;

use std::path::PathBuf;
pub use self::target::Target;
pub use self::target::TargetAction;
pub use self::config_error::ConfigError;

fn get_attribute<'a, 'b>(attributes: &'a Vec<OwnedAttribute>, name: &'b str) -> Option<&'a str> {
    for attribute in &attributes {
        if attribute.name == name {
            Some(attribute.value)
        }
    }
    None
}

fn get_target_name_by_path<'a>(path: &Vec<&str>, parser: &'a mut XmlReader<File>) -> Result<&'a str, ConfigError<'a>> {

    enum State {
        WaitingForPaths,
        WaitingForPExpectingPForNext,
        WaitingForPExpectingPForCurrent,
        // WaitingForAnEndP,
    }

    let mut path_iter = path.into_iter();
    let mut state = State::WaitingForPaths;
    let mut current_path: &str;
    loop {
        match parser.next() {
            Ok(XmlEvent::StartElement { name, attributes, .. }) => {
                match state {
                    State::WaitingForPaths if name == "paths" => {
                        // Into XMLElement paths
                        state = State::WaitingForPExpectingPForNext;
                    }
                    State::WaitingForPExpectingPForNext => {
                        if name == "p" { // Other tag name is ignored
                            match path_iter.next() {
                                Some(current) => {
                                    let name = match get_attribute(&attributes, "value") {
                                        Some(name) => name,
                                        None => { return Err(ConfigError::PathNodeNameNotSet); } 
                                    };
                                    if current == name { // If match, continue, if not, return err
                                        current_path = current;
                                        // state = State::WaitingForPExpectingPForNext;
                                    } else {
                                        state = State::WaitingForPExpectingPForCurrent; // Go to check next child node
                                    }
                                }
                                None => {
                                    // End of input paths, try get target
                                    return match get_attribute(&attributes, "target") {
                                        Some(value) => Ok(value),
                                        None => Err(ConfigError::TargetNotSet)
                                    };
                                }
                            }
                        }
                    }
                    State::WaitingForPExpectingPForCurrent => {
                        let name = match get_attribute(&attributes, "value") {
                            Some(name) => name,
                            None => { return Err(ConfigError::PathNodeNameNotSet); } 
                        };
                        if current_path == name { // If match, continue, if not, return err
                            state = State::WaitingForPExpectingPForNext;
                        } else {
                            // state = State::WaitingForPExpectingPForCurrent; // Go to check next child node
                        }
                    }
                }
            }
            Ok(XmlEvent::EndElement { name }) => {
                match state {
                    State::WaitingForPaths => {
                        
                    }
                    State::WaitingForPExpectingPForNext => {
                        return Err(ConfigError::UnexpectedPath);
                    }
                    State::WaitingForPExpectingPForCurrent => {
                        // Quiting current children enumeration
                        return Err(ConfigError::UnexpectedPath);
                    }
                }
            }
            Err(e) => {
                Err(ConfigError::FailParse { inner_error: e })
            }
            _ => ()
        };
    }
}

fn get_target_by_name<'a>(target_name: &str, parser: &'a mut XmlReader<File>) -> Result<Target<'a>, ConfigError<'a>> {

    let in_targets = false;
    let recording = false; // recording pathadd and scriptexec
    let ret_val = Vec::new(); // ret_val's inner

    loop {
        match parser.next() {
            Ok (XmlEvent::StartElement { name, attributes, .. }) => {
                if name == "targets" {
                    in_targets = true;
                    continue;
                } else if in_targets && name == "target" {
                    match get_attribute(&attributes, "name") {
                        Some(name) if name == target_name => {
                            in_targets = false; // Found first, no need to go back
                            recording = true;
                        }
                        None => {
                            // Ignore <target> without @name
                        }
                    };
                } else if recording {
                    match get_attribute(&attributes, "value") {
                        Some(value) => {
                            match name {
                                "pathadd" => ret_val.push(TargetAction::PathAdd(PathBuf::from(value))),
                                "scriptexec" => ret_val.push(TargetAction::ScriptExecute(PathBuf::from(value))),
                                _ => { /* Ignore other <> in <target> */ }
                            }
                        }
                        None => {
                            // Ignore <pathadd> and <scriptexec> or other <> in <target> without @value
                        }
                    }
                }
            }
        }
    };
    
    // Will return empty if not found
    Ok(Target::Actions(ret_val))
}

pub fn get_target<'a>(path: Vec<&str>) -> Result<Target<'a>, ConfigError<'a>> {
    
    let file = try!(File::open(".env")
        .map_err(|e| ConfigError::FailOpenFile { inner_error: e }));
    let parser = XmlReader::new(file);

    try!(get_target_name_by_path(&path, &mut parser)
        .and_then(|name| get_target_by_name(name, &mut parser)))
}

#[cfg(test)]
mod tests {
    use super::get_target;

    #[test]
    fn load_xml_file() {
        match get_target(vec!["vcpp", "19", "amd64"]) {
            Ok(_) => (),
            Err(e) => perrorln!("Error: {}", e),
        }
    }
}