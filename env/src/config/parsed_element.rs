
use std::fmt::{ self, Debug, Formatter };
use super::xml::attribute::OwnedAttribute;
use super::xml::name::OwnedName;

#[derive(PartialEq, Eq)]
pub struct PathNodeInner<'a> {
    pub values: Vec<&'a str>,
    pub target: Option<&'a str>
}

impl<'a> PathNodeInner<'a> {
    pub fn has(&self, val: &str) -> bool {
        for value in &self.values {
            if *value == val {
                return true;
            }
        }
        false
    }
}

impl<'a> Debug for PathNodeInner<'a> {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        write!(f, "p: {:?} => {}", self.values, self.target.unwrap_or("(Not set)"))
    }
}

#[derive(PartialEq, Eq)]
pub enum ParsedElement<'a> {
    Paths,
    Targets,
    PathNode {
        inner: PathNodeInner<'a>
    },
    TargetNode {
        name: Option<&'a str>
    },
    PathAdd(Option<&'a str>),
    ScriptExecute(Option<&'a str>),
    Unknown {
        tag_name: &'a str
    }
}

fn get_attribute<'a, 'b>(attributes: &'a Vec<OwnedAttribute>, name: &'b str) -> Option<&'a str> {
    for attribute in attributes {
        if attribute.name.local_name == name {
            return Some(&attribute.value);
        }
    }
    None
}

impl<'a> ParsedElement<'a> {
    pub fn from(name: &'a OwnedName, attributes: &'a Vec<OwnedAttribute>) -> ParsedElement<'a> {
        match &*name.local_name {
            "paths" => ParsedElement::Paths,
            "targets" => ParsedElement::Targets,
            "p" => ParsedElement::PathNode {
                inner: PathNodeInner {
                    values: match get_attribute(attributes, "value") {
                        Some(raw_alias) => raw_alias.split('|').collect(),
                        None => Vec::new()
                    },
                    target: get_attribute(attributes, "target")
                } 
            },
            "target" => ParsedElement::TargetNode {
                name: get_attribute(attributes, "name")
            },
            "scriptexec" => ParsedElement::ScriptExecute(get_attribute(attributes, "path")),
            "pathadd" => ParsedElement::PathAdd(get_attribute(attributes, "value")),
            another_name => ParsedElement::Unknown { tag_name: another_name },
        }
    }
} 

impl<'a> Debug for ParsedElement<'a> {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        use self::ParsedElement::*;
        match *self {
            Paths => write!(f, "------ Paths Start ------"),
            Targets => write!(f, "------ Targets Start ------"),
            PathNode { ref inner } => write!(f, "p: {:?}", inner),
            TargetNode { ref name } => write!(f, "target: {}", name.unwrap_or("(Not set)")),
            PathAdd(value) => write!(f, "pathadd: {}", value.unwrap_or("(Not set)")),
            ScriptExecute(value) => write!(f, "scriptexec: {}", value.unwrap_or("(Not set)")),
            Unknown { ref tag_name } => write!(f, "other: {}", tag_name),
        }
    }
}  

#[cfg(test)]
mod tests {

    use super::ParsedElement;
    use super::PathNodeInner;
    use super::super::xml::attribute::OwnedAttribute;
    use super::super::xml::name::OwnedName;

    fn owned_name(name: &str) -> OwnedName {
        OwnedName { 
            local_name: name.to_owned(), 
            namespace: None, 
            prefix: None 
        }
    }
    fn owned_attr(name_value_pairs: &[(&str, &str)]) -> Vec<OwnedAttribute> {
        let mut ret_val = Vec::new();
        for pair in name_value_pairs {
            ret_val.push(OwnedAttribute { name: owned_name(&pair.0), value: pair.1.to_owned() });
        }
        ret_val
    }
    
    fn test_facility_test() {
        perrorln!("[");
        for attr in owned_attr(&[("name", "123"), ("target", "some target")]) {
            perrorln!("{}", attr);
        }
        perrorln!("]");
    }

    fn create() {

        macro_rules! test_case {
            ($name: expr, $attr: expr, $target: expr) => (
                let name = owned_name($name);
                let attr = owned_attr($attr);
                let parsed = ParsedElement::from(&name, &attr);
                assert_eq!(parsed, $target);
            )
        }

        test_case!("paths", &[], ParsedElement::Paths);
        test_case!("targets", &[], ParsedElement::Targets);

        test_case!("p", &[], 
            ParsedElement::PathNode { inner: PathNodeInner { values: Vec::new(), target: None } });
        test_case!("p", &[("value", "some value|1|2|12w3|wedf|"), ("target", "some target")],
            ParsedElement::PathNode { inner: PathNodeInner {
                values: vec!["some value", "1", "2", "12w3", "wedf", ""], 
                target: Some("some target") } });

        test_case!("scriptexec", &[], 
            ParsedElement::ScriptExecute(None));
        test_case!("scriptexec", &[("value", "value of exec"), ("some", "some other value")],
            ParsedElement::ScriptExecute(Some("value of exec")));
        test_case!("pathadd", &[], 
            ParsedElement::PathAdd(None));
        test_case!("pathadd", &[("value", "value of pathadd"), ("some", "some other value")],
            ParsedElement::PathAdd(Some("value of pathadd")));

        test_case!("someother", &[], 
            ParsedElement::Unknown { tag_name: "someother" });

        test_case!("target", &[], 
            ParsedElement::TargetNode { name: None });
        test_case!("target", &[("name", "a target name")],
            ParsedElement::TargetNode { name: Some("a target name") });
    }

    fn path_node_inner() {
        let inner = PathNodeInner { values: vec!["value1", "alias1", "alias2"], target: None };
        assert_eq!(inner.has("value1"), true);
        assert_eq!(inner.has("alias2"), true);
        assert_eq!(inner.has("asdasd"), false);
    }
}