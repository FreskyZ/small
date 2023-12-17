// make wave file from basic musical tones,
// this is actually the successor of beep.cpp and beepwave.cpp in this folder to learn music theory

// this seems to be a rather complete collection of wave file format
// https://www.mmsp.ece.mcgill.ca/Documents/AudioFormats/WAVE/WAVE.html
// it says additional setup required to use channels more than 2 and bit depth more than 16,
// so this implementation completely always use 2 channels, 16 bit depth and 44.1khz sample rate

use std::fmt;
use std::f32::consts::PI;
use std::io::{Error, Write, Seek, BufWriter, SeekFrom};

pub const SAMPLE_RATE: usize = 44100;

// TODO std::concat_byte! is not stable,
// after switched to that, the sample rate and bitrate can be written directly
const HEADER_TEMPLATE: &str = concat!(
	// riff chunk header magic
	"RIFF",
	// riff chunk size, to be filled with total size - 8
	// = sample count * 2 (bytes per sample) * 2 (channels)
	//   + 8 (data chunk header + chunk size) + 24 (fmt chunk) + 8 (the "WAVE" + the "fmt ")
	"\x00\x00\x00\x00",
	// wave chunk header mangic
	"WAVE",
	// fmt chunk header magic
	"fmt ",
	// fmt chunk size: 16, exclude the magic and this size
	"\x10\x00\x00\x00",
	// format tag: WAVE_FORMAT_PCM = 1
	"\x01\x00",
	// channel count: 2
	"\x02\x00",
	// sample rate: 44.1khz
    // NOTE this should be \x44\xAC\x00\x00, but bare \xAC is invalid utf-8 sequence, so assign later
	"\x00\x00\x00\x00",
	// bitrate as in bytes,
	// = 44100 (sample rate) * 2 (bytes per sample) * 2 (channel count) = 176400
    // NOTE this should be \x10\xB1\x02\x00, but bare \xB1 is invalid utf-8 sequence, so assign later
	"\x00\x00\x00\x00",
	// block align
	// = bytes for sample * channel = 4
	"\x04\x00",
	// bit depth (bytes per sample as bit count): 16
	"\x10\x00",
	// data chunk header magic
	"data",
	// data chunk size
	// to be filled with sample count * bytes per sample * channels
	"\x00\x00\x00\x00",
);

// create audio file from sample values
// sample value is f32, which is good enough because result sample value is u16,
// there will be really many fp values and this is exactly
// the exception case in the recommendation "normally you should always prefer f64"
fn serialize(file_name: &str, samples: &[f32]) -> Result<(), Error> {
    println!("making {}.mp3", file_name);

    let file = std::fs::File::create(format!("{}.wav", file_name))?;
    let mut writer = BufWriter::new(file);
    writer.write(HEADER_TEMPLATE.as_bytes())?;
    
    let sample_count = samples.len();
    for &sample in samples {
        let sample_data = (sample * 32767f32) as u16;
        writer.write(&sample_data.to_le_bytes())?;
        writer.write(&sample_data.to_le_bytes())?;
    }

    let mut file = writer.into_inner().unwrap();
    // fix for the sample rate and bitrate
    file.seek(SeekFrom::Start(24))?;
    file.write(&(SAMPLE_RATE as u32).to_le_bytes())?;
    file.seek(SeekFrom::Start(28))?;
    file.write(&((SAMPLE_RATE * 4) as u32).to_le_bytes())?;
    // riff chunk size and data chunk size
    file.seek(SeekFrom::Start(4))?;
    file.write(&((sample_count * 4 + 40) as u32).to_le_bytes())?;
    file.seek(SeekFrom::Start(40))?;
    file.write(&((sample_count * 4) as u32).to_le_bytes())?;

    file.flush()?;

    // call ffmpeg to convert that to mp3
    let input_file_name = format!("{}.wav", file_name);
    let output_file_name = format!("{}.mp3", file_name);
    let ffmpeg_output = std::process::Command::new("ffmpeg")
        // -vn: no video
        // -b:a 192k: output bitrate
        // -ar 44100: output sample rate, not need here
        // -ac 2: output channel count, not need here
        // -y: confirm overwrite output file
        .args(["-i", &input_file_name, "-vn", "-b:a", "192k", "-hide_banner", "-y", &output_file_name])
        .output()?;
    if !ffmpeg_output.status.success() {
        let stdout = String::from_utf8_lossy(&ffmpeg_output.stdout);
        let stderr = String::from_utf8_lossy(&ffmpeg_output.stderr);
        panic!("failed to execute ffmpeg\n{}\n{}\n", stdout, stderr);
    }

    // std::fs::remove_file(input_file_name)?;
    Ok(())
}

// floating point arithmetic is currently completely not const eval,
// so you cannot constexpr double C4 = some calculation for now, so use these

// https://en.wikipedia.org/wiki/Scientific_pitch_notation
// https://en.wikipedia.org/wiki/Accidental_(music)

// bit 0-2: pitch name: C, D, E, F, G, A, B,
//          represented as bits 0-2 in their ASCII code, 0 for rest
// bit 3-5: octave: 0 to 7,
//          although there is 8 on piano, I guess that will not be used for now, 0 for rest
// bit 6-8: accidental, 0 for natural, 1 for sharp, 2 for flat,
//          reversed 3 for double sharp, resereved 4 for double flat
// bit 9-11: note value, full, half, quarter, etc.
//           represented as in 1/2^value note
// bit 12: tie to next note
// bit 16-31: loadness,
//            represented as in value / 32767, 0 for rest
#[derive(Clone, Copy)]
struct Note(u32);

// public type
#[allow(dead_code)]
#[derive(Clone, Copy, Debug)]
enum PitchName { Rest = 0, A = 1, B = 2, C = 3, D = 4, E = 5, F = 6, G = 7 }

#[allow(dead_code)]
#[derive(Clone, Copy, Debug)]
enum Accidental { Natural = 0, Sharp = 1, Flat = 2 }

// use _number is a lot easier to read then eighth, sixteenth, thirtysecond and hundredtwentyeighth
#[allow(dead_code)]
#[derive(Clone, Copy, Debug)]
enum NoteValue { Full = 0, Half = 1, Quarter = 2, _8 = 3, _16 = 4, _32 = 5, _64 = 7, _128 = 8 }

impl fmt::Display for Note {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self.accidental() {
            Accidental::Sharp => write!(f, "\u{266F}")?,
            Accidental::Flat => write!(f, "\u{266D}")?,
            _ => {},
        }
        if matches!(self.name(), PitchName::Rest) {
            write!(f, "z/{}", 1 << (self.value() as u8))
        } else {
            write!(f, "{}{}/{}", (self.name() as u8 | 0x40) as char, self.octave(), 1 << (self.value() as u8))
        }
    }
}
impl fmt::Debug for Note {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.debug_struct("Note")
            .field("name", &self.name())
            .field("octave", &self.octave())
            .field("accidental", &self.accidental())
            .field("value", &self.value())
            .field("loadness", &self.loadness())
            .field("frequency", &self.frequency())
            .field("duration(60bpm)", &self.duration(60))
            .finish_non_exhaustive()
    }
}

// default A4/4, 25% loadness
impl Default for Note {
    fn default() -> Self {
        Self(0x2000_0000 | 0b0000_010_000_100_001)
    }
}

impl Note {
    pub fn name(self) -> PitchName {
        unsafe { std::mem::transmute((self.0 & 0x7) as u8) }
    }
    pub fn with_name(self, name: PitchName) -> Self {
        Self((self.0 & !0x7) | name as u8 as u32)
    }

    pub fn octave(self) -> u8 {
        ((self.0 & 0x38) >> 3) as u8
    }
    pub fn with_octave(self, octave: u8) -> Self {
        Self((self.0 & !0x38) | (octave << 3) as u32)
    }

    pub fn accidental(self) -> Accidental {
        unsafe { std::mem::transmute(((self.0 & 0x1C0) >> 6) as u8) }
    }
    pub fn with_accidental(self, accidental: Accidental) -> Self {
        Self((self.0 & !0x1C0) | ((accidental as u8 as u32) << 6))
    }

    pub fn value(self) -> NoteValue {
        unsafe { std::mem::transmute(((self.0 & 0xE00) >> 9) as u8) }
    }
    pub fn with_value(self, value: NoteValue) -> Self {
        Self((self.0 & !0xE00) | ((value as u8 as u32) << 9))
    }

    pub fn loadness(self) -> f32 {
        ((self.0 & 0xFFFF0000) >> 16) as f32 / 32767f32
    }
    #[allow(dead_code)]
    pub fn with_loadness(self, loadness: f32) -> Self {
        Self((self.0 & 0xFFFF) | (((loadness * 32767f32) as u32) << 16))
    }

    pub fn tie(self) -> bool {
        (self.0 & 0x1000) == 0x1000
    }
    pub fn with_tie(self, tie: bool) -> Self {
        Self((self.0 & !0x1000) | if tie { 0x1000 } else { 0 })
    }

    // NOTE: prefer sharp
    #[allow(dead_code)]
    pub fn with_sharp(self) -> Self {
        // for now accidental only occupies 2 bits,
        // so name+accidental only occupies 5 bits and can easily use calculated goto
        // 0-2 name + 3-4 accidental map to 0-2 name, 3-5 accidental, 6 octave increase)
        const MAP: &[u8] = &[
            /* rest => rest */ 0,
            /* a = 00, n = 001: A  => A# */ 0b00_001_001,
            /* a = 00, n = 010: B  => C  */ 0b01_000_011,
            /* a = 00, n = 011: C  => C# */ 0b00_001_011,
            /* a = 00, n = 100: D  => D# */ 0b00_001_100,
            /* a = 00, n = 101: E  => F  */ 0b00_000_110,
            /* a = 00, n = 110: F  => F# */ 0b00_001_110,
            /* a = 00, n = 111: G  => G# */ 0b00_001_111,
            /* rest => rest */ 0,
            /* a = 01, n = 001: A# => B  */ 0b00_000_010,
            /* a = 01, n = 010: C  => C# */ 0b00_001_011,
            /* a = 01, n = 011: C# => D  */ 0b00_000_100,
            /* a = 01, n = 100: D# => E  */ 0b00_000_101,
            /* a = 01, n = 101: F  => F# */ 0b00_001_110,
            /* a = 01, n = 110: F# => G  */ 0b00_000_111,
            /* a = 01, n = 111: G# => A  */ 0b00_000_001,
            /* rest => rest */ 0,
            /* a = 10, n = 001: Ab => A  */ 0b00_000_001,
            /* a = 10, n = 010: Bb => B  */ 0b00_000_010,
            /* a = 10, n = 011: B  => C  */ 0b01_000_011,
            /* a = 10, n = 100: Db => D  */ 0b00_000_100,
            /* a = 10, n = 101: Eb => E  */ 0b00_000_101,
            /* a = 10, n = 110: E  => F  */ 0b00_000_110,
            /* a = 10, n = 111: Gb => G  */ 0b00_000_111,
        ];
        let map_result = MAP[((self.0 & 0x7) | ((self.0 & 0x1C0) >> 3)) as usize];
        self.with_name(unsafe { std::mem::transmute(map_result & 0x7) })
            .with_accidental(unsafe { std::mem::transmute(map_result & 0x38) })
            .with_octave(self.octave() + ((map_result & 0x40) >> 6))
    }

    // NOTE: prefer sharp
    #[allow(dead_code)]
    pub fn with_flat(self) -> Self {
        // for now accidental only occupies 2 bits,
        // so name+accidental only occupies 5 bits and can easily use calculated goto
        // 0-2 name + 3-4 accidental map to 0-2 name, 3-5 accidental, 6 octave decrease absolute value)
        const MAP: &[u8] = &[
            /* rest => rest */ 0,
            /* a = 00, n = 001: A  => G# */ 0b00_001_111,
            /* a = 00, n = 010: B  => A# */ 0b00_001_001,
            /* a = 00, n = 011: C  => B  */ 0b01_000_010,
            /* a = 00, n = 100: D  => C# */ 0b00_001_011,
            /* a = 00, n = 101: E  => D# */ 0b00_001_100,
            /* a = 00, n = 110: F  => E  */ 0b00_000_101,
            /* a = 00, n = 111: G  => F# */ 0b00_001_110,
            /* rest => rest */ 0,
            /* a = 01, n = 001: A# => A  */ 0b00_000_001,
            /* a = 01, n = 010: C  => B  */ 0b01_000_010,
            /* a = 01, n = 011: C# => C  */ 0b00_000_011,
            /* a = 01, n = 100: D# => D  */ 0b00_000_100,
            /* a = 01, n = 101: F  => E  */ 0b00_000_101,
            /* a = 01, n = 110: F# => F  */ 0b00_000_110,
            /* a = 01, n = 111: G# => G  */ 0b00_000_111,
            /* rest => rest */ 0,
            /* a = 10, n = 001: Ab => G  */ 0b00_000_111,
            /* a = 10, n = 010: Bb => A  */ 0b00_000_001,
            /* a = 10, n = 011: B  => A# */ 0b00_001_001,
            /* a = 10, n = 100: Db => C  */ 0b00_000_011,
            /* a = 10, n = 101: Eb => D  */ 0b00_000_100,
            /* a = 10, n = 110: E  => D# */ 0b00_001_100,
            /* a = 10, n = 111: Gb => F  */ 0b00_000_110,
        ];
        let map_result = MAP[((self.0 & 0x7) | ((self.0 & 0x1C0) >> 3)) as usize];
        self.with_name(unsafe { std::mem::transmute(map_result & 0x7) })
            .with_accidental(unsafe { std::mem::transmute(map_result & 0x38) })
            .with_octave(self.octave() - ((map_result & 0x40) >> 6))
    }

    pub fn frequency(self) -> f32 {
        // for now accidental only occupies 2 bits,
        // so name+accidental only occupies 5 bits and can easily use calculated goto
        // base frequency is octave is 4
        const MAP: &[f32] = &[
            /* rest */ 0.0,
            /* a = 00, n = 001: A  */ 440.0,
            /* a = 00, n = 010: B  */ 493.8833012561241,
            /* a = 00, n = 011: C  */ 261.6255653005987,
            /* a = 00, n = 100: D  */ 293.66476791740763,
            /* a = 00, n = 101: E  */ 329.62755691287003,
            /* a = 00, n = 110: F  */ 349.228231433004,
            /* a = 00, n = 111: G  */ 391.99543598174944,
            /* rest */ 0.0,
            /* a = 01, n = 001: A# */ 466.1637615180899,
            /* a = 01, n = 010: C  */ 261.6255653005987,
            /* a = 01, n = 011: C# */ 277.18263097687213,
            /* a = 01, n = 100: D# */ 311.126983722081,
            /* a = 01, n = 101: F  */ 349.228231433004,
            /* a = 01, n = 110: F# */ 369.9944227116345,
            /* a = 01, n = 111: G# */ 415.3046975799453,
            /* rest */ 0.0,
            /* a = 10, n = 001: Ab */ 415.3046975799453,
            /* a = 10, n = 010: Bb */ 466.1637615180899,
            /* a = 10, n = 011: B  */ 493.8833012561241,
            /* a = 10, n = 100: Db */ 277.18263097687213,
            /* a = 10, n = 101: Eb */ 311.126983722081,
            /* a = 10, n = 110: E  */ 329.62755691287003,
            /* a = 10, n = 111: Gb */ 369.9944227116345,
        ];
        let map_result = MAP[((self.0 & 0x7) | ((self.0 & 0x1C0) >> 3)) as usize];
        // for octave < 4 this is unsigned underflow: map_result * (1 << (self.octave() - 4)) as f32
        map_result / 16f32 * (1 << self.octave()) as f32
    }

    pub fn duration(self, bpm: usize) -> f64 {
        60f64 / bpm as f64 / (1 << (self.value() as u8)) as f64
    }
}

fn parse(raw: &str) -> Vec<Note> {
    let mut result = Vec::new();

    // use semicolon to split measure, but will not likely to validate time specification
    for raw_by_semicolon in raw.split(';') {
        for raw_by_whitespace in raw_by_semicolon.split(' ') {
            let raw_notes = raw_by_whitespace.split('-').collect::<Vec<_>>();
            for (note_index, &raw_note) in raw_notes.iter().enumerate() {
                if raw_note.is_empty() { continue; }
                let mut raw_note = raw_note;
                if raw_note.starts_with("z") {
                    raw_note = &raw_note[2..]; // also skip the /
                    let value = unsafe { std::mem::transmute(raw_note.parse::<u8>().unwrap().ilog2() as u8) };
                    result.push(Note::default().with_name(PitchName::Rest).with_octave(0).with_value(value));
                } else {
                    let (len, accidental) = if raw_note.starts_with('b') { (1, Accidental::Flat)
                        } else if raw_note.starts_with('#') { (1, Accidental::Sharp) } else { (0, Accidental::Natural) };
                    raw_note = &raw_note[len..];
                    let name = unsafe { std::mem::transmute(raw_note.as_bytes()[0] & 0x7) };
                    raw_note = &raw_note[1..];
                    let octave = raw_note[..1].parse().unwrap();
                    raw_note = &raw_note[2..]; // also skip the /
                    let value = unsafe { std::mem::transmute(raw_note.parse::<u8>().unwrap().ilog2() as u8) };
                    let tie = raw_notes.len() > 1 && note_index < raw_notes.len() - 1;
                    result.push(Note::default()
                        .with_name(name).with_octave(octave).with_accidental(accidental).with_value(value).with_tie(tie));
                }
            }
        }
    }
    result
}

// sampling a track of notes
fn sample(bpm: usize, tracks: &[&[Note]]) -> Box<[f32]> {

    let mut all_samples = Vec::with_capacity(tracks.len());
    let mut max_sample_count = 0;
    for &notes in tracks {
        let total_duration = notes.iter().fold(0f64, |acc, note| acc + note.duration(bpm));
        // note duration * sample rate + note count * gap length + arbitrary length for precision loss
        let estimate_sample_count = (total_duration * SAMPLE_RATE as f64) as usize + notes.len() * 2205 + 100;
        let mut samples = Vec::with_capacity(estimate_sample_count);
        for note in notes {
            let frequency = note.frequency();
            for t in 0..(note.duration(bpm) * SAMPLE_RATE as f64) as usize {
                samples.push(f32::sin(2f32 * PI * frequency * t as f32 / SAMPLE_RATE as f32) * note.loadness());
            }
            if !note.tie() {
                samples.extend(std::iter::repeat(0f32).take(2205));
            }
        }
        max_sample_count = usize::max(max_sample_count, samples.len());
        all_samples.push(samples);
    }

    let track_count = tracks.len() as f32;
    let mut result = Vec::with_capacity(max_sample_count);
    for t in 0..max_sample_count {
        result.push(all_samples.iter().map(|track| *track.get(t).unwrap_or(&0f32)).sum::<f32>() / track_count);
    }
    result.into_boxed_slice()
}

fn main() -> Result<(), Error> {

    // serialize("majorscalec", &sample(&[&[
    //     note!(C4/4), note!(D4/4), note!(E4/4), note!(F4/4), note!(G4/4), note!(A4/4), note!(B4/4), note!(C5/4),
    // ]]))?;
    // serialize("minorscalea", &sample(&[&[
    //     note!(A3/4), note!(B3/4), note!(C4/4), note!(D4/4), note!(E4/4), note!(F4/4), note!(G4/4), note!(A4/4),
    // ]]))?;
    // serialize("minorscalec", &sample(&[&[
    //     note!(C4/4), note!(D4/4), note!(#D4/4), note!(F4/4), note!(G4/4), note!(#G4/4), note!(#A4/4), note!(C5/4),
    // ]]))?;

    // serialize("birthday", &sample(60, &[&parse(concat!(
    //     "G4/8-G4/8-G4/8 G4/8 A4/2 G4/2 C5/2 B4/1;",
    //     "G4/8-G4/8-G4/8 G4/8 A4/2 G4/2 D5/2 C5/1;",
    //     "G4/8-G4/8-G4/8 G4/8 G5/2 E5/2 C5/2 B4/2 A4/2;",
    //     "F5/8-F5/8-F5/8 F5/8 E5/2 C5/2 D5/2 C5/1;",
    // ))]))?;

    // serialize("ctriad", &sample(60, &[
    //     &parse("C4/1"),
    //     &parse("E4/1"),
    //     &parse("G4/1"),
    // ]))?;

    // let mut notes = Vec::new();
    // for pitch in ["C4", "D4", "E4", "F4", "G4", "A4", "B4"] {
    //     for i in 0..100 {
    //         notes.push(note!(pitch, 0.0001, i as f32 * 0.0025));
    //     }
    //     notes.push(note!(pitch, 0.8, 0.25));
    //     for i in 0..100 {
    //         notes.push(note!(pitch, 0.0001, 0.2475 - i as f32 * 0.0025));
    //     }
    // }
    // make_audio_file("majorscale", &[sample(&notes)])?;

    serialize("micorazonencantado", &sample(60, &[&parse(concat!(
        "G5/4 G5/4 E5/8 F5/8 G5/8 A5/8;",
        "G5/4 F5/4 E5/4 D5/4;",
        "E5/4 E5/4 C5/8 D5/8 E5/8 G5/8;",
        "E5/4 D5/4 C5/4 B4/4;",
        "z/4 A4/8 A4/8 C5/4 A5/4;",
        "G5/2 C5/4 D5/8 C5/8;",
        "F5/4 E5/4 D5/4 C5/4;",
        "D5/2 C5/4 B4/4 C5/1-C5/1-C5/1;",
        "z/1;",
        "z/2 C5/8 C5/8 C5/8 C5/8;",
        "C5/4 bB4/8 bA4/4 bB4/8 C5/4;",
        "bB4/2 bB4/8 bB4/8 bB4/8 bB4/8;",
        "bB4/8 bB4/8 bA4/8 G4/4 bA4/8 bB4/4;",
        "bA4/2 bA4/8 bA4/8 bA4/8 bA4/8;",
        "bA4/4 G4/4 G4/4 F4/4;",
        "F4/4 G4/4 bE4/8 F4/4 G4/8-G4/2-G4/8 bA4/4 bB4/8;",
        "C5/2 C5/8 C5/8 C5/8 C5/8;",
        "C5/4 bB4/8 bA4/4 bB4/8 C5/4;",
        "bB4/2 bB4/8 C5/8 D5/8 z/8;", // TODO what is the --3--
        "D5/4 bE5/4 bB4/8 bA4/8 G4/8 z/8;",
        "bA4/2-bA4/8 bB4/4 bA4/8;",
        "G4/8 G4/8 z/8 G4/8 G4/8 G5/8 F5/8 z/8;",
        "F5/2 F5/8 bE5/8 D5/8 bE5/8-bE5/2 C5/4 D5/4;",
        "bE5/8 bE5/8 z/8 D5/8 E5/4-E5/8 D5/8;",
        "bE5/4-bE5/8 C5/8 F5/8 E5/8 D5/8 C5/8;",
        "C5/8 bB4/8 bB4/8 G4/8 bB4/8 bB4/4 G4/8;",
        "bB4/2 bB4/8 C5/8 D5/8 z/8;",
        "bE5/8 D5/8 bE5/8 z/8 C5/2;",
        "bE5/8 D5/8 bE5/8 z/8 C5/8 C5/8 G5/4;",
        "F5/4-F5/8 F5/8 F5/8 bE5/8 F5/8 G5/8-G5/1;",
        "G5/4 G5/4 E5/8 F5/8 G5/8 A5/8;",
        "G5/4 F5/4 E5/4 D5/4;",
        "E5/4 E5/4 C5/8 D5/8 E5/8 F5/8;",
        "E5/4 D5/4 C5/4 B4/4;",
        "z/4 A4/8 A4/8 C5/4 A5/4;",
        "G5/2 C5/4 D5/8 E5/8;",
        "F5/4 E5/4 D5/9 C5/8 C5/8 D5/8;",
        "E5/4 F5/4 D5/2;",
        "G5/4 G5/4 E5/8 F5/8 G5/8 A5/8;",
        "G5/4 F5/4 E5/4 D5/4;",
        "E5/4 E5/4 C5/8 D5/8 E5/8 F5/8;",
        "E5/4 D5/4 C5/4 B4/4;",
        "z/4 A4/8 A4/8 C5/4 A5/4;",
        "G5/2 C5/4 D5/8 E5/8;",
        "F5/4 E5/4 D5/4 C5/4;",
        "D5/2 C5/4 B4/4;",
        "C5/1-C5/1-C5/1;",
    ))]))?;

    Ok(())
}
