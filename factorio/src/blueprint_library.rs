
// the structured storage for blueprint library

use std::fmt;
use chrono::{DateTime, Utc};

// still borrow the buffer
pub struct BlueprintLibrary<'a> {
    pub file_version: Version,
    pub file_timestamp: DateTime<Utc>,
    pub prints: Vec<Print<'a>>,
}

pub type Version = (u16, u16, u16, u16);

// should be no need to pretty print
impl<'a> fmt::Debug for BlueprintLibrary<'a> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        writeln!(f, "file version {:?}", self.file_version)?;
        writeln!(f, "file timestamp {}", self.file_timestamp)?;
        for print in &self.prints {
            write!(f, "{:?}", print)?;
        }
        Ok(())
    }
}

pub struct Blueprint<'a> {
    pub version: Version,
    pub description: &'a str,
    pub snap_to_grid: Option<SnapToGrid>,
    pub entities: Vec<BlueprintEntity<'a>>,
}

impl<'a> fmt::Debug for Blueprint<'a> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        writeln!(f, "blueprint {:?}", self.version)?;
        if !self.description.is_empty() {
            write!(f, "  description: {}", self.description)?;
        }
        if let Some(snap) = &self.snap_to_grid {
            write!(f, "  snap to grid {:?}, {:?}", snap.size, snap.absolute)?;
        }
        for entity in &self.entities {
            write!(f, "{:?}", entity)?;
        }
        Ok(())
    }
}

pub struct BlueprintBook {}

impl fmt::Debug for BlueprintBook {
    fn fmt(&self, _f: &mut fmt::Formatter) -> fmt::Result {
        Ok(())
    }
}
pub struct UpgradePlan {}

impl fmt::Debug for UpgradePlan {
    fn fmt(&self, _f: &mut fmt::Formatter) -> fmt::Result {
        Ok(())
    }
}
pub struct DeconstructionPlan {}

impl fmt::Debug for DeconstructionPlan {
    fn fmt(&self, _f: &mut fmt::Formatter) -> fmt::Result {
        Ok(())
    }
}

pub enum Print<'a> {
    Blueprint(Blueprint<'a>),
    BlueprintBook(BlueprintBook),
    UpgradePlan(UpgradePlan),
    DeconstructionPlan(DeconstructionPlan),
}
impl<'a> fmt::Debug for Print<'a> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::Blueprint(item) => write!(f, "{:?}", item),
            Self::BlueprintBook(item) => write!(f, "{:?}", item),
            Self::UpgradePlan(item) => write!(f, "{:?}", item),
            Self::DeconstructionPlan(item) => write!(f, "{:?}", item),
        }
    }
}

pub struct SnapToGrid {
    // grid size
    pub size: (u32, u32),
    // absolute snapping relative to map coordinate, both 0 for not absolute snapping
    pub absolute: (u32, u32),
}

pub struct BlueprintEntity<'a> {
    pub kind: EntityKind<'a>,
    pub position: (f64, f64),
}

impl<'a> fmt::Debug for BlueprintEntity<'a> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "  entity {} {:?}", self.kind.name(), self.position)?;
        Ok(())
    }
}

pub enum EntityKind<'a> {
    // ATTENTION TODO dummy string to keep using the 'a, remove when other variant use 'a
    Roboport(&'a str),
}

impl<'a> EntityKind<'a> {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Roboport(_) => "roboport",
        }
    }
}

pub struct Roboport {
    
}
