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

// #region PathNode
#[derive(PartialEq, Eq)]
pub struct PathNode {
    pub names: Vec<String>,
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
        write!(f, "P: {:?} => {:?}", 
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
pub enum ConfigEventFull {
    NotCare,
    XMLParseError { e: Error },

    StartPaths,
    StartTargets,
    StartP { inner: PathNode },
    StartTarget { name: Option<String> },
    PathAdd { value: String },
    ScriptExecute { value: String },

    StartOther { tag_name: String },

    EndPaths,
    EndTargets,
    EndP,
    EndTarget,
}

impl Debug for ConfigEventFull {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        use self::ConfigEventFull::*;
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
            XMLParseError { ref e } => write!(f, "XMLReader error: {:?}", e),
            _ => write!(f, "(Not care)"), // Ignored
        }
    }
}  

#[derive(Debug)]
pub enum ConfigEvent {

    StartPaths,
    StartP { inner: PathNode },
    EndP,
    EndPaths,

    StartTargets,
    StartTarget { name: String },
    PathAdd { value: String },
    ScriptExecute { path: String },
    EndTarget,
    EndTargets,

    XMLReaderError { e: Error },
}
// #endregion

// #region ConfigParser
pub struct ConfigParser {
    parser: EventReader<File>,

    next_finished: bool,
    in_some_paths: bool,
    in_some_targets: bool,
}

impl ConfigParser {
    pub fn from(file_name: &str) -> Result<ConfigParser, Error> {
        File::open(file_name)
            .map(|file| ConfigParser { 
                parser: EventReader::new(file), 
                next_finished: false,
                in_some_paths: false,
                in_some_targets: false,
            })
            .map_err(|e| Error::FailOpenFile { inner_error: e })
    }

    // Remove invalid p and its children
    // Remove invliad target and its children
    // Invalid p: value is not set value deduped and remove empty and then is not empty and not in paths, to be checked
    // Invalid target: name is empty or not set, child is empty, remove invalid child and is empty, to be checked
    // Skip not care, check
    // paths in p and targets in target is parse error: InvalidFormat, check
    pub fn next_valid(&mut self) -> Option<ConfigEvent> {

        if self.next_finished {
            return None; // Should stop iteration
        }

        // let mut depth = 0;
        // let mut in_invalid_path = false;
        // let mut path_become_valid_after_endp_at_depth = 0;
        // let mut in_invalid_target = false;

        loop {
            let raw_next = self.next();
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
                    return Some(ConfigEvent::StartPaths); 
                }
                Some(ConfigEventFull::StartP { inner }) => { 
                    if self.in_some_paths { 
                        return Some(ConfigEvent::StartP { inner: inner }); 
                    } else {
                        continue;
                    }
                }
                Some(ConfigEventFull::EndP) => { 
                    if self.in_some_paths { 
                        return Some(ConfigEvent::EndP); 
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
                        match name {
                            Some(name) => { return Some(ConfigEvent::StartTarget { name: name }); }
                            None => { return Some(ConfigEvent::StartTarget { name: "(Empty)".to_owned() }); }
                        }
                    } else {
                        continue;
                    }
                }
                Some(ConfigEventFull::PathAdd { value }) => { 
                    if self.in_some_targets {
                        return Some(ConfigEvent::PathAdd { value: value }); 
                    } else {
                        continue;
                    }
                }
                Some(ConfigEventFull::ScriptExecute { value }) => {
                    if self.in_some_targets { 
                        return Some(ConfigEvent::ScriptExecute { path: value });
                    } else {
                        continue;
                    } 
                }
                Some(ConfigEventFull::EndTarget) => { 
                    if self.in_some_targets {
                        return Some(ConfigEvent::EndTarget); 
                    } else {
                        continue;
                    }
                }
                Some(ConfigEventFull::EndTargets) => {
                    self.in_some_targets = false; 
                    return Some(ConfigEvent::EndTargets); 
                }

                // xml error
                Some(ConfigEventFull::XMLParseError { e }) => { return Some(ConfigEvent::XMLReaderError { e: e }); }
            }
        }
    }
}

// to avoid too complication, only first paths and targets are examined
// any other things except p and target are low level error, (•̀ ω •́ )y
// next is for valid, next_internal is full

impl Iterator for ConfigParser {
    type Item = ConfigEventFull;

    // Wrap XMLReaderEvent to ConfigEvent, remove invalid nodes
    // provide only valid StartP and StartTarget: in paths and targets, with proper attributes
    fn next(&mut self) -> Option<ConfigEventFull> {

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
                        // if ret_val.is_empty() {
                        //     ConfigEvent::NotCare
                        // } else {
                            ConfigEventFull::StartP { inner: ret_val }
                        // }
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


#[cfg(test)]
mod tests {
    
    use super::PathNode;
    use super::ConfigEventFull as ConfigEvent;
    use super::ConfigParser;
    use super::ConfigEvent as ConfigEventValid;
    use super::super::error::Error;

    macro_rules! config_event_next_care {
        ($parser: expr) => ({
            let ret_val: ConfigEvent;
            loop {
                let next = $parser.next();
                if let Some(inner) = next {
                    match inner {
                        ConfigEvent::NotCare => {
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
            if let ConfigEvent::StartOther { tag_name } = next {
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
            if let ConfigEvent::StartP { inner } = next {
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
                ConfigEvent::EndP => (),
                other => panic!("next is not endp but is {:?}", other),
            }
        )
    }
    macro_rules! config_event_is_target {
        ($parser: expr, $name: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEvent::StartTarget { name } => {
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
                ConfigEvent::StartTarget { name } => {
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
                ConfigEvent::EndTarget => (),
                other => panic!("next is not end target but is {:?}", other),
            }
        )
    }
    macro_rules! config_event_is_paths {
        ($parser: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEvent::StartPaths => (),
                other => panic!("next is not end target but is {:?}", other),
            }
        )
    }
    macro_rules! config_event_is_targets {
        ($parser: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEvent::StartTargets => (),
                other => panic!("next is not end target but is {:?}", other),
            }
        )
    }    
    macro_rules! config_event_is_endpaths {
        ($parser: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEvent::EndPaths => (),
                other => panic!("next is not end target but is {:?}", other),
            }
        )
    }
    macro_rules! config_event_is_endtargets {
        ($parser: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEvent::EndTargets => (),
                other => panic!("next is not end target but is {:?}", other),
            }
        )
    }
    macro_rules! config_event_is_path_add {
        ($parser: expr, $value: expr) => (
            let next = config_event_next_care!($parser);
            match next {
                ConfigEvent::PathAdd { value } => {
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
                ConfigEvent::ScriptExecute { value } => {
                    if value != $path.to_owned() {
                        panic!("next is script exec but path is {:?}", value);
                    }
                }
                other => panic!("next is not script exec but is {:?}", other),
            }
        )
    }  
    #[test]
    // #[ignore]
    fn parser_full() {
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
            config_event_is_p!(parser, vec!["vcpp".to_owned(), "msvc".to_owned()], "msvc-19-amd64");
                config_event_is_p!(parser, vec!["19".to_owned(), "vs14".to_owned(), "vs2015".to_owned()]);
                    config_event_is_p!(parser, vec!["x86".to_owned()], "msvc-19-x86");
                    config_event_is_endp!(parser);
                    config_event_is_p!(parser, vec!["amd64".to_owned(), "x64".to_owned()], "msvc-19-amd64");
                    config_event_is_endp!(parser);
                config_event_is_endp!(parser);
                config_event_is_p!(parser, vec!["x86".to_owned()], "msvc-19-x86");
                config_event_is_endp!(parser);
                config_event_is_p!(parser, vec!["amd64".to_owned(), "x64".to_owned()], "msvc-19-amd64");
                config_event_is_endp!(parser);
            config_event_is_endp!(parser);
            config_event_is_p!(parser, vec!["".to_owned()]);
                config_event_is_p!(parser, vec!["some value".to_owned()]);
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
            config_event_is_target!(parser, "valid name with empty");
            config_event_is_endtarget!(parser);
            config_event_is_target!(parser, "valid name with seem not empty");
            config_event_is_endtarget!(parser);
            config_event_is_target!(parser, "msvc-19-amd64");
                config_event_is_script_exec!(parser, "script for cl64");
                config_event_is_path_add!(parser, "path add value for cl64");
                config_event_is_script_exec!(parser, "another script for cl64");
            config_event_is_endtarget!(parser);
            config_event_is_endtargets!(parser);
    }


    macro_rules! n_start_p {
        () => ()
    }
    macro_rules! n_start_target {
        () => ()
    }
    macro_rules! n_start_paths {
        ($parser: expr) => ({
            let next = $parser.next_valid();
            match next {
                Some(ConfigEventValid::StartPaths) => (),
                _ => panic!("Next is not StartPaths but is {:?}", next),
            }
        })
    }    
    macro_rules! n_start_targets {
        () => ()
    }    
    macro_rules! n_end_paths {
        () => ()
    }    
    macro_rules! n_end_targets {
        () => ()
    }    
    macro_rules! n_path_add {
        () => ()
    }
    macro_rules! n_script_exec {
        () => ()
    }

    // skip invalid path, target, pathadd and scriptexec
    #[test]
    fn parser_valid() {
        let mut parser = match ConfigParser::from(".env_full") {
            Ok(parser) => parser,
            Err(e) => panic!("{:?}", e),
        };

        n_start_paths!(parser);

        loop {
            match parser.next_valid() {
                Some(e) => perrorln!("{:?}", e),
                None => break,
            }
        }
    }
    
    // semantic error on other things in paths and targets
    #[test]
    fn parser_semantic() {
        // Should meet invalid format error in these 2 parses

        fn test_case(file: &str) {
            let mut parser = match ConfigParser::from(file) {
                Ok(parser) => parser,
                Err(e) => panic!("{:?}", e),
            };

            let mut had_expected_fail = false;
            loop {
                match parser.next_valid() {
                    Some(some_event) => {
                        match some_event {
                            ConfigEventValid::XMLReaderError { e } => {
                                match e {
                                    Error::InvalidFormat => {
                                        had_expected_fail = true;
                                        break;
                                    }
                                    other => { perrorln!("other error: {:?}", other) },
                                }
                            }
                            other => { perrorln!("other event: {:?}", other); }
                        }
                    }
                    None => { perrorln!("none here"); break; },
                }
            }
            
            if !had_expected_fail {
                panic!("did not had expected fail of {}", file);
            }
        }
        
        test_case(".env_to_invalid_in_paths");
        test_case(".env_to_invalid_in_targets");
    }
}