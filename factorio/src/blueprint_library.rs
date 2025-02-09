
// the structured storage for blueprint library

use std::{fmt, marker::PhantomData};
use chrono::{DateTime, Utc};

// still borrow the buffer
pub struct BlueprintLibrary<'a> {
    pub file_version: Version,
    pub file_timestamp: DateTime<Utc>,
    pub phantom: PhantomData<&'a ()>,
}

pub type Version = (u16, u16, u16, u16);

// should be no need to pretty print
impl<'a> fmt::Debug for BlueprintLibrary<'a> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        writeln!(f, "file version {:?}", self.file_version)?;
        writeln!(f, "file timestamp {}", self.file_timestamp)?;
        
        Ok(())
    }
}
