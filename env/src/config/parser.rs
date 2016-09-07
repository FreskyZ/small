
use std::fs::File;
use std::fmt::{ Debug, Formatter, self };

use super::xml::reader::{ EventReader, XmlEvent };
use super::error::Error;
use super::parsed_element::{ ParsedElement, PathNodeInner as ParsedElementPathNodeInner };

#[derive(PartialEq, Eq)]
pub struct PathNodeInner {
    values: Vec<String>,
    pub target: Option<String>
}

fn parsed_element_path_node_inner_to_path_node_inner(element: ParsedElementPathNodeInner) -> PathNodeInner {
    let mut values = Vec::new();
    for value in element.values {
        values.push(value.to_owned());
    }
    PathNodeInner { values: values, target: element.target.map(|t| t.to_owned()) }
}

impl PathNodeInner {
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

impl Debug for PathNodeInner {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        write!(f, "p: {:?} => {:?}", self.values, self.target)
    }
}

#[derive(Debug)]
pub enum ConfigEvent {
    NotCare,
    XMLParserError { e: Error },

    StartPaths,
    StartTargets,
    StartP { inner: PathNodeInner },
    StartTarget { name: String },
    PathAdd { value: String },
    ScriptExecute { value: String },

    StartOther { tag_name: String },

    EndPaths,
    EndTargets,
    EndP,
    EndTarget,
}

// Attention: Remove empty StartTarget, PathAdd and ScriptExec here
fn parsed_element_to_config_event(element: ParsedElement) -> ConfigEvent {
    match element {
        ParsedElement::Paths => ConfigEvent::StartPaths,
        ParsedElement::Targets => ConfigEvent::StartTargets,
        ParsedElement::PathNode { inner } => ConfigEvent::StartP { inner: parsed_element_path_node_inner_to_path_node_inner(inner) },
        ParsedElement::TargetNode { name } => {
            match name {
                Some(name) => ConfigEvent::StartTarget { name: name.to_owned() },
                None => ConfigEvent::NotCare,
            }
        },
        ParsedElement::PathAdd(value) => {
            match value {
                Some(value) => ConfigEvent::PathAdd { value: value.to_owned() },
                None => ConfigEvent::NotCare,
            }
        }
        ParsedElement::ScriptExecute(value) => {
            match value {
                Some(value) => ConfigEvent::ScriptExecute { value: value.to_owned() },
                None => ConfigEvent::NotCare,
            }
        },
        ParsedElement::Unknown { tag_name } => 
            ConfigEvent::StartOther { tag_name: tag_name.to_owned() },
    }
}
fn end_element_name_to_config_event(name: &str) -> ConfigEvent {
    match name {
        "paths" => ConfigEvent::EndPaths,
        "p" => ConfigEvent::EndP,
        "targets" => ConfigEvent::EndTargets,
        "target" => ConfigEvent::EndTarget,
        _ => ConfigEvent::NotCare,
    }
}

pub struct ConfigParser {
    parser: EventReader<File>
}

impl ConfigParser {
    pub fn from(file_name: &str) -> Result<ConfigParser, Error> {
        File::open(file_name)
            .map(|file| ConfigParser { parser: EventReader::new(file) })
            .map_err(|e| Error::FailOpenFile { inner_error: e })
    }
}

impl Iterator for ConfigParser {
    type Item = ConfigEvent;

    fn next(&mut self) -> Option<ConfigEvent> {
        match self.parser.next() {
            Ok(XmlEvent::StartElement { name, attributes, .. }) => 
                Some(parsed_element_to_config_event(ParsedElement::from(&name, &attributes))),
            Ok(XmlEvent::EndElement { name }) => Some(end_element_name_to_config_event(&*name.local_name)),
            Ok(XmlEvent::EndDocument) => None,
            Err(e) => Some(ConfigEvent::XMLParserError { e: Error::FailParse { inner_error: e } }),
            Ok(_) => Some(ConfigEvent::NotCare),
        }
    }
}

#[cfg(test)]
mod tests {
    
    use super::ConfigEvent;
    use super::ConfigParser;

    #[test]
    #[ignore]
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
}