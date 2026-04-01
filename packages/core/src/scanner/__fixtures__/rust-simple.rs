use std::collections::HashMap;
use std::io::{self, Read};

/// A simple key-value store
pub struct Store {
    data: HashMap<String, String>,
}

impl Store {
    /// Create a new empty store
    pub fn new() -> Self {
        Store { data: HashMap::new() }
    }

    /// Get a value by key
    pub fn get(&self, key: &str) -> Option<&String> {
        self.data.get(key)
    }

    fn internal_cleanup(&mut self) {
        self.data.clear();
    }
}

/// Process input from stdin
pub fn process_input() -> io::Result<String> {
    let mut buffer = String::new();
    io::stdin().read_to_string(&mut buffer)?;
    Ok(buffer)
}

fn helper() -> bool {
    true
}

/// Only visible within the crate
pub(crate) fn crate_visible() -> bool {
    helper()
}

pub enum Status {
    Active,
    Inactive,
    Error(String),
}

pub trait Processor {
    fn process(&self, input: &str) -> String;
}

/// Async function for testing async detection
pub async fn fetch_data(url: &str) -> Result<String, Box<dyn std::error::Error>> {
    Ok(url.to_string())
}
