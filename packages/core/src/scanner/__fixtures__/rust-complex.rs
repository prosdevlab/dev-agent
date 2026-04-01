use std::fmt;

/// Server handles HTTP requests
pub struct Server {
    host: String,
    port: u16,
}

pub trait Handler {
    fn handle(&self, request: &str) -> Result<String, Box<dyn std::error::Error>>;
}

impl Handler for Server {
    fn handle(&self, request: &str) -> Result<String, Box<dyn std::error::Error>> {
        let processed = self.process_request(request)?;
        Ok(processed)
    }
}

impl Server {
    pub fn new(host: &str, port: u16) -> Self {
        Server { host: host.to_string(), port }
    }

    fn process_request(&self, data: &str) -> Result<String, Box<dyn std::error::Error>> {
        let trimmed = data.trim();
        let result = format!("{}:{} - {}", self.host, self.port, trimmed);
        Ok(result)
    }
}

impl fmt::Display for Server {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Server({}:{})", self.host, self.port)
    }
}

/// Generic container — tests type parameter stripping
pub struct Container<T> {
    value: T,
}

impl<T: fmt::Display> Container<T> {
    pub fn show(&self) -> String {
        self.value.to_string()
    }
}

fn transform(input: &str) -> String {
    input.to_uppercase()
}

/// Tests callee extraction inside closures
pub fn process_items(items: Vec<String>) -> Vec<String> {
    items.iter().map(|x| transform(x)).collect()
}

/// Tests that field access is NOT a callee
pub fn read_server_host(s: &Server) -> String {
    let _host = s.host.clone();
    s.host.to_uppercase()
}
