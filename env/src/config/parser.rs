// https://github.com/netvl/xml-rs
pub extern crate xml;

use std::fs::File;
use std::fmt::{ Debug, Formatter, self };

use self::xml::reader::{ EventReader, XmlEvent };
use self::xml::attribute::OwnedAttribute;
use super::error::Error;

// #region PathNode
#[derive(PartialEq, Eq)]
pub struct PathNode {
    values: Vec<String>,
    pub target: Option<String>
}

impl PathNode {
    pub fn has(&self, val: &str) -> bool {
        for value in &self.values {
            if *value == val {
                return true;
            }
        }
        false
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    pub fn to_string(&self) -> String {

        if self.is_empty() { 
            String::new() 
        } else {
            let mut ret_val = self.values[0].to_owned();
            if self.values.len() > 1 {
                ret_val.push_str("(");
                for i in 1..self.values.len() - 1 {
                    ret_val.push_str(&*format!("{}, ", self.values[i]));
                }
                ret_val.push_str(&*format!("{})", self.values.last().unwrap()));
            }
            ret_val
        }
    }
}

impl Debug for PathNode {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        let not_set = "(Not set)".to_owned();
        write!(f, "p: {:?} => {:?}", 
            self.values, {
                match &self.target {
                    &Some(ref value) => value,
                    &None => &not_set,
                } 
            })
    }
}
// #endregion

// #region ConfigEvent
pub enum ConfigEvent {
    NotCare,
    XMLParseError { e: Error },

    StartPaths,
    StartTargets,
    StartP { inner: PathNode },
    StartTarget { name: String },
    PathAdd { value: String },
    ScriptExecute { value: String },

    StartOther { tag_name: String },

    EndPaths,
    EndTargets,
    EndP,
    EndTarget,
}

impl Debug for ConfigEvent {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        use self::ConfigEvent::*;
        match *self {
            StartPaths => write!(f, "------ Paths Start ------"),
            StartTargets => write!(f, "------ Targets Start ------"),
            StartP { ref inner } => write!(f, "{:?}", inner),
            StartTarget { ref name } => write!(f, "target: {:?}", name),
            PathAdd { ref value } => write!(f, "pathadd: {}", value),
            ScriptExecute { ref value } => write!(f, "scriptexec: {}", value),
            StartOther { ref tag_name } => write!(f, "other: {}", tag_name),
            EndPaths => write!(f, "------ Paths End ------"),
            EndTargets => write!(f, "------ Targets End ------"),
            EndP => write!(f, "p: end"),
            EndTarget => write!(f, "target: end"),
            _ => write!(f, "(Not care)"), // Ignored
        }
    }
}  

enum ConfigEventFull {

}
// #endregion

// #region ConfigParser
pub struct ConfigParser {
    parser: EventReader<File>
}

impl ConfigParser {
    pub fn from(file_name: &str) -> Result<ConfigParser, Error> {
        File::open(file_name)
            .map(|file| ConfigParser { parser: EventReader::new(file) })
            .map_err(|e| Error::FailOpenFile { inner_error: e })
    }

    pub fn next_full(&mut self) -> Option<ConfigEventFull> {
        None
        // let mut depth = 0;
        // let mut in_some_paths = false;
        // let mut in_some_targets = false;
        // let mut in_invalid_path = false;
        // let mut path_become_valid_after_endp_at_depth = 0;
        // let mut in_invalid_target = false;
    }
}

// to avoid too complication, only first paths and targets are examined
// any other things except p and target are low level error, (•̀ ω •́ )y
// next is for valid, next_internal is full

impl Iterator for ConfigParser {
    type Item = ConfigEvent;

    // Wrap XMLReaderEvent to ConfigEvent, remove invalid nodes
    // provide only valid StartP and StartTarget: in paths and targets, with proper attributes
    fn next(&mut self) -> Option<ConfigEvent> {

        fn get_attribute<'a, 'b>(attributes: &'a Vec<OwnedAttribute>, name: &'b str) -> Option<&'a str> {
            for attribute in attributes {
                if attribute.name.local_name == name {
                    return Some(&attribute.value);
                }
            }
            None
        }

        match self.parser.next() {
            Ok(XmlEvent::StartElement { ref name, ref attributes, .. }) => Some({
                match &*name.local_name {
                    "paths" => ConfigEvent::StartPaths,
                    "targets" => ConfigEvent::StartTargets,
                    "p" => { 
                        let ret_val = PathNode {
                            values: match get_attribute(attributes, "value") {
                                Some(raw_alias) => {
                                    let borrowed_values = raw_alias.split('|').collect::<Vec<&str>>(); // TODO: dedup
                                    let mut ret_val = Vec::new();                                      // TODO: remove empty
                                    for value in borrowed_values {
                                        ret_val.push(value.to_owned());
                                    }
                                    ret_val
                                },
                                None => Vec::new()
                            },
                            target: match get_attribute(attributes, "target") {
                                Some(target) => Some(target.to_owned()),
                                None => None,
                            } 
                        };
                        if ret_val.is_empty() {
                            ConfigEvent::NotCare
                        } else {
                            ConfigEvent::StartP { inner: ret_val }
                        }
                    },
                    "target" => {
                        match get_attribute(attributes, "name") {
                            Some(name) => ConfigEvent::StartTarget { name: name.to_owned() },
                            None => ConfigEvent::NotCare,
                        }
                    },
                    "pathadd" => {
                        match get_attribute(attributes, "value") {
                            Some(value) => ConfigEvent::PathAdd { value: value.to_owned() },
                            None => ConfigEvent::NotCare,
                        }
                    },
                    "scriptexec" => {
                        match get_attribute(attributes, "path") {
                            Some(value) => ConfigEvent::ScriptExecute { value: value.to_owned() },
                            None => ConfigEvent::NotCare,
                        }
                    },
                    another_name => ConfigEvent::StartOther { tag_name: another_name.to_owned() },
                }
            }),

            Ok(XmlEvent::EndElement { name }) => Some({
                match &*name.local_name {
                    "paths" => ConfigEvent::EndPaths,
                    "p" => ConfigEvent::EndP,
                    "targets" => ConfigEvent::EndTargets,
                    "target" => ConfigEvent::EndTarget,
                    _ => ConfigEvent::NotCare,
                }
            }),
              
            Ok(XmlEvent::EndDocument) => None,
            Err(e) => Some(ConfigEvent::XMLParseError { e: Error::FailParse { inner_error: e } }),
            Ok(_) => Some(ConfigEvent::NotCare),
        }
    }
}


#[cfg(test)]
mod tests {
    
    use super::ConfigEvent;
    use super::ConfigParser;

    #[test]
    // #[ignore]
    fn parser() {
        let parser = match ConfigParser::from(".env") {
            Ok(parser) => parser,
            Err(e) => panic!("{:?}", e),
        };
        for event in parser {
            match event {
                ConfigEvent::NotCare => (),
                other_event => perrorln!("{:?}", other_event),
            }
        }
    }

    // skip invalid path, target, pathadd and scriptexec
    #[test]
    fn parser_valid() {

    }
    
    // semantic error on other things in paths and targets
    #[test]
    fn parser_semantic() {

    }
}