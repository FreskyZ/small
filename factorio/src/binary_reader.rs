// basic binary reader from binary buffer
// offerring a little more high level functions like read as u32 and read string

use anyhow::bail;

// NOTE this is borrowing the buffer,
// because the returned &str is borrowing the buffer,
// if this parser owns the buffer, lifetime check cannot distinguish that
pub struct Reader<'a> {
    base: &'a [u8],
    // // why is std::io::Cursor using u64 as position
    position: usize,
}

// construct
impl<'a> Reader<'a> {
    pub fn new(base: &'a [u8]) -> Self {
        Self{ base, position: 0 }
    }
}

// position
impl<'a> Reader<'a> {

    pub fn position(&self) -> usize {
        self.position
    }
    #[allow(dead_code)]
    pub fn set_position(&mut self, position: usize) -> anyhow::Result<()> {
        if position >= self.base.len() { bail!("index out of range") }
        self.position = position;
        Ok(())
    }
    pub fn skip(&mut self, length: usize) -> anyhow::Result<()> {
        if self.position + length >= self.base.len() { bail!("index out of range") }
        self.position += length;
        Ok(())
    }
}

// read
impl<'a> Reader<'a> {

    pub fn read_u8(&mut self) -> anyhow::Result<u8> {
        if self.position == self.base.len() { bail!("index out of range"); }
        let result = self.base[self.position];
        self.position += 1;
        Ok(result)
    }
    // bool is always 0/1, no other value
    pub fn read_bool(&mut self) -> anyhow::Result<bool> {
        if self.position == self.base.len() { bail!("index out of range"); }
        let value = self.base[self.position];
        // capture backtrace: set RUST_BACKTRACE=1
        if value != 0 && value != 1 { bail!("0x{:x}: expect bool, meet {}, {:?}", self.position, value, std::backtrace::Backtrace::capture()); }
        self.position += 1;
        Ok(value != 0)
    }

    pub fn read_u16(&mut self) -> anyhow::Result<u16> {
        if self.position >= self.base.len() - 1 { bail!("index out of range"); }
        let result = u16::from_le_bytes([self.base[self.position], self.base[self.position + 1]]);
        self.position += 2;
        Ok(result)
    }
    pub fn read_i16(&mut self) -> anyhow::Result<i16> {
        if self.position >= self.base.len() - 1 { bail!("index out of range"); }
        let result = i16::from_le_bytes([self.base[self.position], self.base[self.position + 1]]);
        self.position += 2;
        Ok(result)
    }

    pub fn read_u32(&mut self) -> anyhow::Result<u32> {
        if self.position >= self.base.len() - 3 { bail!("index out of range"); }
        let result = u32::from_le_bytes([
            self.base[self.position],
            self.base[self.position + 1],
            self.base[self.position + 2],
            self.base[self.position + 3],
        ]);
        self.position += 4;
        Ok(result)
    }
    pub fn read_i32(&mut self) -> anyhow::Result<i32> {
        if self.position >= self.base.len() - 3 { bail!("index out of range"); }
        let result = i32::from_le_bytes([
            self.base[self.position],
            self.base[self.position + 1],
            self.base[self.position + 2],
            self.base[self.position + 3],
        ]);
        self.position += 4;
        Ok(result)
    }
}

// some advance methods
impl<'a> Reader<'a> {

    // variable length, if not large use one byte, or else allow uin32 length
    pub fn read_length(&mut self) -> anyhow::Result<usize> {
        let maybe_length = self.read_u8()?;
        Ok(if maybe_length == 0xFF { self.read_u32()? as usize } else { maybe_length as usize })
    }
    // string starts with length, no null terminate
    // the returned lifetime need to be explicit, or else it implicitly follow &'self mut self lifetime
    pub fn read_str(&mut self) -> anyhow::Result<&'a str> {
        let length = self.read_length()?;
        let result = std::str::from_utf8(&self.base[self.position..self.position + length])?;
        self.position += length;
        Ok(result)
    }

    pub fn expect(&mut self, expect_byte: u8) -> anyhow::Result<()> {
        let actual = self.read_u8()?;
        if actual != expect_byte {
            bail!("0x{:x}: expect 0x{expect_byte:x} actual 0x{actual:x}", self.position - 1);
        }
        Ok(())
    }

    // the if tile read_u8 else read_u16 seems widely used
    pub fn read_u16_unless_then_u8(&mut self, condition: bool) -> anyhow::Result<usize> {
        Ok(if condition { self.read_u8()? as usize } else { self.read_u16()? as usize })
    }
}
