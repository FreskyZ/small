//! fsz-env config file parser
//!
//! Provide config event based on a XML reader

// https://github.com/netvl/xml-rs
pub extern crate xml;

use std::fs::File;
use std::fmt::{ Debug, Formatter, self };

use self::xml::reader::{ EventReader, XmlEvent };
use self::xml::attribute::OwnedAttribute;
use super::error::Error;
use super::result::TargetAction;

// #region PathNode
#[derive(PartialEq, Eq)]
pub struct PathNode {
    names: Vec<String>,
    pub target: Option<String>
}

impl PathNode {
    pub fn has(&mut self, val: &str) -> bool {
        self.names.iter().find(|&name| name == val).is_some()
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }

    pub fn to_string(&self) -> String {

        if self.is_empty() { 
            String::new() 
        } else {
            let mut ret_val = self.names[0].to_owned();
            if self.names.len() > 1 {
                ret_val.push_str("(");
                for i in 1..self.names.len() - 1 {
                    ret_val.push_str(&*format!("{}, ", self.names[i]));
                }
                ret_val.push_str(&*format!("{})", self.names.last().unwrap()));
            }
            ret_val
        }
    }
}

impl Debug for PathNode {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        let not_set = "(Not set)".to_owned();
        write!(f, "{:?} => {:?}", 
            self.names, {
                match &self.target {
                    &Some(ref value) => value,
                    &None => &not_set,
                } 
            })
    }
}
// #endregion

// #region ConfigEvent
#[derive(Debug)]
enum ConfigEventFull {
    NotCare,
    XMLParseError { e: Error },

    StartPaths,
    StartTargets,
    StartP { inner: PathNode },
    StartTarget { name: Option<String> },
    PathAdd { value: String },
    ScriptExecute { value: String },
    VariableAdd { var: String, value: String },

    StartOther { tag_name: String },

    EndPaths,
    EndTargets,
    EndP,
    EndTarget,
}

pub enum ConfigEvent {

    StartPaths,
    StartP { depth: usize, inner: PathNode },
    EndP { depth: usize },
    EndPaths,

    StartTargets,
    Target { 
        name: String, 
        actions: Vec<TargetAction>,
    },
    EndTargets,

    XMLReaderError { e: Error },
}

const INDENT: [&'static str; 7] 
    = ["", "   ", "      ", "         ", "            ", "               ", "                    "];
impl Debug for ConfigEvent {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        use self::ConfigEvent::*;
        match *self {
            StartPaths => write!(f, "------ Paths Start ------"),
            StartP { ref depth, ref inner } => write!(f, "{}P: {:?}", INDENT[*depth], inner),
            EndP { ref depth } => write!(f, "{}P: end", INDENT[*depth]),
            EndPaths => write!(f, "------ Paths End ------"),

            StartTargets => write!(f, "------ Targets Start ------"),
            Target { ref name, ref actions } => {
                try!(writeln!(f, "T: {:?}", name));
                for action in actions {
                    try!(writeln!(f, "   {:?}", action));
                }
                Ok(())
            } 
            EndTargets => write!(f, "------ Targets End ------"),

            XMLReaderError { ref e } => write!(f, "XMLReader error: {:?}", e),
        }
    }
}  
// #endregion

// #region ConfigParser
pub struct ConfigParser {
    parser: EventReader<File>,

    next_finished: bool,

    in_some_paths: bool,
    in_some_targets: bool,

    current_depth: usize,
    in_invalid_path: bool,
    path_become_valid_after_endp_after_depth: usize,

    in_some_target: bool,

    in_invalid_target: bool,
    target_name_buffer: String,
    target_action_buffer: Vec<TargetAction>,
}

impl ConfigParser {
    pub fn from(file_name: &str) -> Result<ConfigParser, Error> {
        File::open(file_name)
            .map(|file| ConfigParser { 
                parser: EventReader::new(file), 
                next_finished: false,
                in_some_paths: false,
                in_some_targets: false,
                current_depth: 0_usize,
                in_invalid_path: false,
                path_become_valid_after_endp_after_depth: 0_usize,
                in_some_target: false,
                in_invalid_target: false,
                target_name_buffer: String::new(),
                target_action_buffer: Vec::new(),
            })
            .map_err(|e| Error::FailOpenFile { inner_error: e })
    }

    // Wrap XMLReaderEvent to ConfigEvent, remove invalid nodes
    // provide only valid StartP and StartTarget: in paths and targets, with proper attributes
    fn next_full(&mut self) -> Option<ConfigEventFull> {

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
                    "paths" => ConfigEventFull::StartPaths,
                    "targets" => ConfigEventFull::StartTargets,
                    "p" => { 
                        let ret_val = PathNode {
                            names: match get_attribute(attributes, "value") {
                                Some(raw_alias) => {
                                    let borrowed_values = raw_alias.split('|').collect::<Vec<&str>>();
                                    let mut ret_val = Vec::new();
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
                        ConfigEventFull::StartP { inner: ret_val }
                    },
                    "target" => {
                        match get_attribute(attributes, "name") {
                            Some(name) => ConfigEventFull::StartTarget { name: Some(name.to_owned()) },
                            None => ConfigEventFull::StartTarget { name: None },
                        }
                    },
                    "pathadd" => {
                        match get_attribute(attributes, "value") {
                            Some(value) => ConfigEventFull::PathAdd { value: value.to_owned() },
                            None => ConfigEventFull::NotCare,
                        }
                    },
                    "scriptexec" => {
                        match get_attribute(attributes, "path") {
                            Some(value) => ConfigEventFull::ScriptExecute { value: value.to_owned() },
                            None => ConfigEventFull::NotCare,
                        }
                    },
                    "varadd" => {
                        match get_attribute(attributes, "var") {
                            Some(var) => match get_attribute(attributes, "value") {
                                Some(value) => ConfigEventFull::VariableAdd { var: var.to_owned(), value: value.to_owned() },
                                None => ConfigEventFull::NotCare,
                            },
                            None => ConfigEventFull::NotCare,
                        }
                    },
                    another_name => ConfigEventFull::StartOther { tag_name: another_name.to_owned() },
                }
            }),

            Ok(XmlEvent::EndElement { name }) => Some({
                match &*name.local_name {
                    "paths" => ConfigEventFull::EndPaths,
                    "p" => ConfigEventFull::EndP,
                    "targets" => ConfigEventFull::EndTargets,
                    "target" => ConfigEventFull::EndTarget,
                    _ => ConfigEventFull::NotCare,
                }
            }),
              
            Ok(XmlEvent::EndDocument) => None,
            Err(e) => Some(ConfigEventFull::XMLParseError { e: Error::FailParse { inner_error: e } }),
            Ok(_) => Some(ConfigEventFull::NotCare),
        }
    }
}

// to avoid too complication, only first paths and targets are examined
// any other things except p and target are low level error, (•̀ ω •́ )y
// next is for valid, next_internal is full

impl Iterator for ConfigParser {
    type Item = ConfigEvent;

    // Remove invalid pathnode
    // Invalid p: value is not set value deduped and remove empty and then is not empty and not in paths, checked
    // Form target event with all its actions, remove invliad target
    // Invalid target: name is empty or not set, child is empty, remove invalid child and is empty, checked
    // Skip not care, check
    // paths in paths and targets in targets and target in target is parse error: InvalidFormat, check
    fn next(&mut self) -> Option<ConfigEvent> {

        if self.next_finished {
            return None; // Should stop iteration
        }

        loop {
            let raw_next = self.next_full();
            // perrorln!("raw next is {:?}, inpaths = {}, intargets = {}", raw_next, self.in_some_paths, self.in_some_targets);
            match raw_next {
                // All skip
                Some(ConfigEventFull::NotCare) | Some(ConfigEventFull::StartOther { .. }) => { continue; }
                None => { return None; }

                // paths
                Some(ConfigEventFull::StartPaths) => { 
                    if self.in_some_paths {
                        // Have in some paths, format error and return
                        self.next_finished = true; // Will be finished, other things are not important
                        return Some(ConfigEvent::XMLReaderError { e: Error::InvalidFormat });
                    }
                    self.in_some_paths = true; 
                    self.current_depth = 0_usize;
                    return Some(ConfigEvent::StartPaths); 
                }
                Some(ConfigEventFull::StartP { inner }) => { 
                    if !self.in_some_paths {
                        continue;
                    } 
                    self.current_depth += 1;

                    let mut ret_val = inner;
                    ret_val.names.dedup();
                    ret_val.names.retain(|ref x| **x != "".to_owned());
                    
                    if ret_val.is_empty() {
                        // invalid path and invalidate all children
                        self.in_invalid_path = true;
                        self.path_become_valid_after_endp_after_depth = self.current_depth - 1;
                        continue;
                    } 
                    else if self.in_invalid_path {
                        // valid path in invalid path
                        continue;
                    } 
                    // Valid path in valid path
                    return Some(ConfigEvent::StartP { depth: self.current_depth - 1, inner: ret_val });
                }
                Some(ConfigEventFull::EndP) => { 
                    if !self.in_some_paths {
                        continue;
                    }
                    self.current_depth -= 1;

                    let should_return = !self.in_invalid_path;
                    if self.in_invalid_path && self.current_depth == self.path_become_valid_after_endp_after_depth {
                        // invalid path ends
                        self.in_invalid_path = false;
                    }
                    
                    if should_return {
                        return Some(ConfigEvent::EndP { depth: self.current_depth });
                    } else {
                        continue;
                    }
                }
                Some(ConfigEventFull::EndPaths) => { 
                    self.in_some_paths = false;
                    return Some(ConfigEvent::EndPaths); 
                }

                // targets
                Some(ConfigEventFull::StartTargets) => {
                    if self.in_some_targets {
                        self.next_finished = true;
                        return Some(ConfigEvent::XMLReaderError { e: Error::InvalidFormat });
                    }
                    self.in_some_targets = true;
                    return Some(ConfigEvent::StartTargets); 
                }
                Some(ConfigEventFull::StartTarget { name }) => {
                    if self.in_some_targets {
                        // In some target control
                        if self.in_some_target {
                            self.next_finished = true;
                            return Some(ConfigEvent::XMLReaderError { e: Error::InvalidFormat });
                        } 
                        self.in_some_target = true; // Always in some target, even if in invalid target

                        match name {
                            Some(name) => { 
                                self.in_invalid_target = false;
                                self.target_action_buffer.clear();
                                self.target_name_buffer = name;
                                // return Some(ConfigEvent::StartTarget { name: name });
                                continue; 
                            }
                            None => { 
                                self.in_invalid_target = true;
                                //return Some(ConfigEvent::StartTarget { name: "(Invalid)".to_owned() });
                                continue; 
                            }
                        }
                    } else {
                        continue;
                    }
                }
                Some(ConfigEventFull::PathAdd { value }) => { 
                    if self.in_some_targets && self.in_some_target && !self.in_invalid_target {
                        if !value.is_empty() {
                            self.target_action_buffer.push(TargetAction::PathAdd(value));
                        }
                    }
                }
                Some(ConfigEventFull::ScriptExecute { value }) => {
                    if self.in_some_targets && self.in_some_target && !self.in_invalid_target {
                        if !value.is_empty() {
                            self.target_action_buffer.push(TargetAction::ScriptExecute(value));
                        }
                    }
                }
                Some(ConfigEventFull::VariableAdd { var, value }) => {
                    if self.in_some_targets && self.in_some_target && !self.in_invalid_target {
                        if !var.is_empty() && !value.is_empty() {
                            self.target_action_buffer.push(TargetAction::VariableAdd(var, value));
                        }
                    }
                }
                Some(ConfigEventFull::EndTarget) => { 
                    if self.in_some_targets {
                        self.in_some_target = false;
                        
                        if !self.in_invalid_target {
                            self.target_action_buffer.dedup();
                            if !self.target_action_buffer.is_empty() {
                                return Some(ConfigEvent::Target {
                                    name: self.target_name_buffer.clone(),
                                    actions: self.target_action_buffer.clone(),
                                });
                            }
                        }
                    } else {
                        continue;
                    }
                }
                Some(ConfigEventFull::EndTargets) => {
                    self.in_some_targets = false; 
                    return Some(ConfigEvent::EndTargets); 
                }

                // xml error
                Some(ConfigEventFull::XMLParseError { e }) => { 
                    self.next_finished = true;
                    return Some(ConfigEvent::XMLReaderError { e: e }); 
                }
            }
        }
    }
}

#[cfg(test)]
#[test]
// #[ignore]
fn parser_full() {

    macro_rules! config_event_next_care {
        ($parser: expr) => ({
            let ret_val: ConfigEventFull;
            loop {
                let next = $parser.next_full();
                if let Some(inner) = next {
                    match inner {
                        ConfigEventFull::NotCare => {
                            continue;
                        }
                        _ => {
                            ret_val = inner;
                            break;
                        }
                    }
                } else {
                    panic!("parser iteration end");
                }
            }
            ret_val
        })
    }
    macro_rules! config_event_is_start_other {
        ($parser: expr, $tag_name: expr) => (
            let next = config_event_next_care!($parser);
            if let ConfigEventFull::StartOther { tag_name } = next {
                if $tag_name != tag_name {
                    panic!("next start other is not this tag name");
                } 
            } else {
                panic!("next is not start other but is {:?}", next);
            }
        )
    }
    macro_rules! config_event_is_p {
        ($parser: expr, $names: expr, $target_name: expr, $dummy: expr) => (
            let next = config_event_next_care!($parser);
            if let ConfigEventFull::StartP { inner } = next {
                assert_eq!(inner, PathNode { names: $names, target: $target_name });
            }
        );
        ($parser: expr, $names: expr, $target_name: expr) => (
            config_event_is_p!($parser, $names, Some($target_name.to_owned()), 1);
        );
        ($parser: expr, $names: expr) => {
            config_event_is_p!($parser, $names, None, 1);
        }
    }
    macro_rules! config_event_is_endp {
        ($parser: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEventFull::EndP => (),
                other => panic!("next is not endp but is {:?}", other),
            }
        )
    }
    macro_rules! config_event_is_target {
        ($parser: expr, $name: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEventFull::StartTarget { name } => {
                    if name != Some($name.to_owned()) {
                        panic!("next is start target but name is {:?}", name);
                    }
                }
                other => panic!("next is not start target but is {:?}", other),
            }
        );
        ($parser: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEventFull::StartTarget { name } => {
                    if name != None {
                        panic!("next is start target but name is not none");
                    }
                }
                other => panic!("next is not start target but is {:?}", other),
            }
        )
    }   
    macro_rules! config_event_is_endtarget {
        ($parser: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEventFull::EndTarget => (),
                other => panic!("next is not end target but is {:?}", other),
            }
        )
    }
    macro_rules! config_event_is_paths {
        ($parser: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEventFull::StartPaths => (),
                other => panic!("next is not end target but is {:?}", other),
            }
        )
    }
    macro_rules! config_event_is_targets {
        ($parser: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEventFull::StartTargets => (),
                other => panic!("next is not end target but is {:?}", other),
            }
        )
    }    
    macro_rules! config_event_is_endpaths {
        ($parser: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEventFull::EndPaths => (),
                other => panic!("next is not end target but is {:?}", other),
            }
        )
    }
    macro_rules! config_event_is_endtargets {
        ($parser: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEventFull::EndTargets => (),
                other => panic!("next is not end target but is {:?}", other),
            }
        )
    }
    macro_rules! config_event_is_path_add {
        ($parser: expr, $value: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEventFull::PathAdd { value } => {
                    if value != $value.to_owned() {
                        panic!("next is path add but value is {:?}", value);
                    }
                }
                other => panic!("next is not path add but is {:?}", other),
            }
        )
    }  
    macro_rules! config_event_is_script_exec {
        ($parser: expr, $path: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEventFull::ScriptExecute { value } => {
                    if value != $path.to_owned() {
                        panic!("next is script exec but path is {:?}", value);
                    }
                }
                other => panic!("next is not script exec but is {:?}", other),
            }
        )
    }  

    let mut parser = match ConfigParser::from(".env_full") {
        Ok(parser) => parser,
        Err(e) => panic!("{:?}", e),
    };

    config_event_is_start_other!(parser, "env");
    config_event_is_start_other!(parser, "config");
    config_event_is_start_other!(parser, "dummy");
    config_event_is_p!(parser, vec!["123".to_owned()]);
    config_event_is_endp!(parser);
    config_event_is_target!(parser, "invalid target here");
    config_event_is_endtarget!(parser);
    config_event_is_p!(parser, vec!["another outter p".to_owned()]);
    config_event_is_endp!(parser);
    config_event_is_paths!(parser);
        config_event_is_p!(parser, vec!["gcc".to_owned(), "gnuc".to_owned()], "gcc-rubenvb-463");
            config_event_is_p!(parser, vec!["rubenvb".to_owned()]);
                config_event_is_p!(parser, vec!["4.6.3".to_owned(), "463".to_owned()], "gcc-rubenvb-463");
                config_event_is_endp!(parser);
            config_event_is_endp!(parser);
            config_event_is_p!(parser, vec!["4.6.3".to_owned(), "463".to_owned()], "gcc-rubenvb-463");
            config_event_is_endp!(parser);
        config_event_is_endp!(parser);
        config_event_is_p!(parser, vec!["".to_owned()]);
            config_event_is_p!(parser, vec!["some value".to_owned()]);
            config_event_is_endp!(parser);
        config_event_is_endp!(parser);
        config_event_is_p!(parser, vec!["vcpp".to_owned(), "msvc".to_owned()], "msvc-19-amd64");
            config_event_is_p!(parser, vec!["19".to_owned(), "vs14".to_owned(), "vs2015".to_owned()]);
                config_event_is_p!(parser, vec!["x86".to_owned()], "msvc-19-x86");
                config_event_is_endp!(parser);
                config_event_is_p!(parser, vec!["amd64".to_owned(), "x64".to_owned()], "msvc-19-amd64");
                config_event_is_endp!(parser);
            config_event_is_endp!(parser);
            config_event_is_p!(parser, vec![]);
                config_event_is_p!(parser, vec!["valid in invalid in valid".to_owned()]);
                config_event_is_endp!(parser);
            config_event_is_endp!(parser);
            config_event_is_p!(parser, vec!["x86".to_owned()], "msvc-19-x86");
            config_event_is_endp!(parser);
            config_event_is_p!(parser, vec!["amd64".to_owned(), "x64".to_owned()], "msvc-19-amd64");
            config_event_is_endp!(parser);
        config_event_is_endp!(parser);
        config_event_is_p!(parser, vec!["".to_owned(), "".to_owned()]);
            config_event_is_p!(parser, vec!["some value2".to_owned()]);
            config_event_is_endp!(parser);
        config_event_is_endp!(parser);
        config_event_is_p!(parser, vec![]);
            config_event_is_p!(parser, vec!["asdasd".to_owned()]);
                config_event_is_p!(parser, vec!["asdasd".to_owned()]);
                config_event_is_endp!(parser);
            config_event_is_endp!(parser);
            config_event_is_p!(parser, vec!["asdasdas".to_owned()]);
            config_event_is_endp!(parser);
        config_event_is_endp!(parser);
    config_event_is_endpaths!(parser);
    config_event_is_targets!(parser);
        config_event_is_target!(parser, "gcc-rubenvb-463");
            config_event_is_path_add!(parser, r"C:\Program Files\Haskell Platform\7.10.2-a\mingw\bin");
        config_event_is_endtarget!(parser);
        config_event_is_target!(parser);
            config_event_is_path_add!(parser, "something in invalid");
        config_event_is_endtarget!(parser);
        config_event_is_target!(parser, "msvc-19-x86");
            config_event_is_script_exec!(parser, "...");
        config_event_is_endtarget!(parser);
        config_event_is_path_add!(parser, "pathadd outside");
        config_event_is_target!(parser, "valid name with empty");
        config_event_is_endtarget!(parser);
        config_event_is_target!(parser, "valid name with seem not empty");
            config_event_is_script_exec!(parser, "");
        config_event_is_endtarget!(parser);
        config_event_is_script_exec!(parser, "scriptexec outside");
        config_event_is_target!(parser, "msvc-19-amd64");
            config_event_is_script_exec!(parser, "script for cl64");
            config_event_is_path_add!(parser, "path add value for cl64");
            config_event_is_script_exec!(parser, "another script for cl64");
        config_event_is_endtarget!(parser);
    config_event_is_endtargets!(parser);
    config_event_is_p!(parser, vec!["123".to_owned()]);
    config_event_is_endp!(parser);
    config_event_is_target!(parser, "invalid target here");
    config_event_is_endtarget!(parser);
    config_event_is_p!(parser, vec!["another outter p".to_owned()]);
    config_event_is_endp!(parser);
}

#[cfg(test)]
#[test]
fn parser_valid() {

    use self::ConfigEvent::*;
    use super::result::TargetAction::*;

    macro_rules! n_start_p {
        ($parser: ident, [$($names:tt)*]) => ({
            let next = $parser.next();
            if let Some(StartP { depth: _depth, inner }) = next {
                let borrowed_names = vec![$($names)*];
                let mut owned_names = Vec::new();
                for name in borrowed_names {
                    owned_names.push(name.to_owned());
                }
                assert_eq!(PathNode { names: owned_names, target: None }, inner);
            } else {
                panic!("next is not StartP but is {:?}", next);
            }
        });
        ($parser: ident, [$($names:tt)*] => $target: expr) => ({
            let next = $parser.next();
            if let Some(StartP { depth: _depth, inner }) = next {
                let borrowed_names = vec![$($names)*];
                let mut owned_names = Vec::new();
                for name in borrowed_names {
                    owned_names.push(name.to_owned());
                }
                assert_eq!(PathNode { names: owned_names, target: Some($target.to_owned()) }, inner);
            } else {
                panic!("next is not StartP but is {:?}", next);
            }
        })
    }
    macro_rules! n_start_target {
        ($parser: ident, $name: expr, $($actions:tt)+) => (
            let next = $parser.next();
            if let Some(Target { name, actions }) = next {
                assert_eq!($name.to_owned(), name);
                assert_eq!(vec![$($actions)+], actions);
            } else {
                panic!("next is not start target but is {:?}", next);
            }
        )
    }

    macro_rules! n_end_p {
        ($parser: ident) => (
            let next = $parser.next();
            match next {
                Some(EndP { .. }) => (),
                _ => panic!("Next is not EndP but is {:?}", next),
            }
        )
    }

    macro_rules! n_none {
        ($parser: expr, $name: path) => (
            let next = $parser.next();
            match next {
                Some($name) => (),
                _ => panic!("Next is not {} but is {:?}", stringify!($name), next),
            }
        )
    }
    macro_rules! n_start_paths {
        ($parser: ident) => (n_none!($parser, StartPaths))
    }    
    macro_rules! n_start_targets {
        ($parser: ident) => (n_none!($parser, StartTargets))
    }
    macro_rules! n_end_paths {
        ($parser: ident) => (n_none!($parser, EndPaths))
    }    
    macro_rules! n_end_targets {
        ($parser: ident) => (n_none!($parser, EndTargets))
    }    

    let mut parser = match ConfigParser::from(".env_full") {
        Ok(parser) => parser,
        Err(e) => panic!("{:?}", e),
    };
    
    n_start_paths!(parser);
        n_start_p!(parser, ["gcc", "gnuc"] => "gcc-rubenvb-463");
            n_start_p!(parser, ["rubenvb"]);
                n_start_p!(parser, ["4.6.3", "463"] => "gcc-rubenvb-463");
                n_end_p!(parser);
            n_end_p!(parser);
            n_start_p!(parser, ["4.6.3", "463"] => "gcc-rubenvb-463");
            n_end_p!(parser);
        n_end_p!(parser);
        n_start_p!(parser, ["vcpp", "msvc"] => "msvc-19-amd64");
            n_start_p!(parser, ["19", "vs14", "vs2015"]);
                n_start_p!(parser, ["x86"] => "msvc-19-x86");
                n_end_p!(parser);
                n_start_p!(parser, ["amd64", "x64"] => "msvc-19-amd64");
                n_end_p!(parser);
            n_end_p!(parser);
            n_start_p!(parser, ["x86"] => "msvc-19-x86");
            n_end_p!(parser);
            n_start_p!(parser, ["amd64", "x64"] => "msvc-19-amd64");
            n_end_p!(parser);
        n_end_p!(parser);
    n_end_paths!(parser);
    n_start_targets!(parser);
        n_start_target!(parser, "gcc-rubenvb-463", 
            PathAdd(r"C:\Program Files\Haskell Platform\7.10.2-a\mingw\bin".to_owned()));
        n_start_target!(parser, "msvc-19-x86", 
            ScriptExecute("...".to_owned()));
        n_start_target!(parser, "msvc-19-amd64",
            ScriptExecute("script for cl64".to_owned()),
            PathAdd("path add value for cl64".to_owned()),
            ScriptExecute("another script for cl64".to_owned()));
    n_end_targets!(parser);
        
    loop {
        match parser.next() {
            Some(e) => perrorln!("{:?}", e),
            None => break,
        }
    }
}

// semantic error on other things in paths and targets and target
#[cfg(test)]
#[test]
fn parser_semantic() {
    // Should meet invalid format error in these 3 parses

    fn test_case(file: &str) {
        let mut parser = match ConfigParser::from(file) {
            Ok(parser) => parser,
            Err(e) => panic!("{:?}", e),
        };

        let mut had_expected_fail = false;
        loop {
            match parser.next() {
                Some(some_event) => {
                    match some_event {
                        ConfigEvent::XMLReaderError { e } => {
                            match e {
                                Error::InvalidFormat => {
                                    had_expected_fail = true;
                                    break;
                                }
                                _ => () // other => { perrorln!("other error: {:?}", other) },
                            }
                        }
                        _ => () // other => { perrorln!("other event: {:?}", other); }
                    }
                }
                _ => { break; } // None => { perrorln!("none here"); break; },
            }
        }
        
        if !had_expected_fail {
            panic!("did not had expected fail of {}", file);
        }
    }
    
    test_case(".env_to_invalid_in_paths");
    test_case(".env_to_invalid_in_targets");
    test_case(".env_to_invalid_in_target");
}