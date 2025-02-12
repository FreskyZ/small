
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
    pub entity_id: usize, // NOTE this is not blueprint json format's entity number
    pub items: Vec<(&'a str, usize)>, // item name and count
}

impl<'a> fmt::Debug for BlueprintEntity<'a> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        writeln!(f, "  entity {} {:?} #{}", self.kind.name(), self.position, self.entity_id)?;
        for (item_name, item_count) in &self.items {
            writeln!(f, "    item {} x {}", item_name, item_count)?;
        }
        Ok(())
    }
}

pub struct CircuitConnections {
    // (entity id, circuit id)[], NOTE entity id is not blueprint json format's entity number
    pub red: Vec<(usize, usize)>,
    pub green: Vec<(usize, usize)>,
}

#[derive(Debug)]
pub enum SignalKind {
    Item,
    Fluid,
    Virtual,
}

pub struct Signal<'a> {
    pub kind: SignalKind,
    pub name: &'a str,
}

pub enum EntityKind<'a> {
    Roboport(Roboport<'a>),
}

impl<'a> EntityKind<'a> {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Roboport(_) => "roboport",
        }
    }
}

pub struct Roboport<'a> {
    pub circuit_connections: Option<CircuitConnections>,
    // control behaviors
    pub read_logistics: bool,
    pub read_robot_stats: bool,
    pub available_logistic_output_signal: Option<Signal<'a>>,
    pub total_logistic_output_signal: Option<Signal<'a>>,
    pub available_construction_output_signal: Option<Signal<'a>>,
    pub total_construction_output_signal: Option<Signal<'a>>,
    // NEW in 2.0
    pub roboport_count_output_signal: Option<Signal<'a>>,
}

impl<'a> fmt::Debug for Roboport<'a> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        writeln!(f, "    read_logistics {}", self.read_logistics)?;
        writeln!(f, "    read_robots_stats {}", self.read_robot_stats)?;
        if let Some(signal) = &self.available_logistic_output_signal {
            writeln!(f, "    available_logistic_output_signal {:?} {}", signal.kind, signal.name)?;
        }
        if let Some(signal) = &self.total_logistic_output_signal {
            writeln!(f, "    total_logistic_output_signal {:?} {}", signal.kind, signal.name)?;
        }
        if let Some(signal) = &self.available_construction_output_signal {
            writeln!(f, "    available_construction_output_signal {:?} {}", signal.kind, signal.name)?;
        }
        if let Some(signal) = &self.total_construction_output_signal {
            writeln!(f, "    total_construction_output_signal {:?} {}", signal.kind, signal.name)?;
        }
        if let Some(signal) = &self.roboport_count_output_signal {
            writeln!(f, "    roboport_count_output_signal {:?} {}", signal.kind, signal.name)?;
        }
        Ok(())
    }
}