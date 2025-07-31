//! Level 0 parser, from text, give exactly next char, record row and column

pub struct TextParser {
    origin: String,
    position: usize, // next char index
    row: i32,        // next char row
    column: i32,     // next char column
}

impl From<String> for TextParser {
    
}

impl TextParser {

    pub fn new(origin: String) -> TextParser {
        TextParser {
            origin: origin,
            position: 0,
            row: 1,
            column: 0,
        }
    }

    // Get exactly next char except LF or CRLF
    // Set position, row and column when moving forward, LF and CRLF are all line end
    pub fn next_char(&mut self) -> Option<char> {

        if self.origin.len() <= self.position {
            return None;
        }

        let next1 = origin[position..position + 1].chars().next().unwrap();
        if next1 == '\n'
    }
}