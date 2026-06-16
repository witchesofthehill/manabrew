use std::collections::HashMap;

pub trait Identifiable {
    fn id(&self) -> i32;
}

pub trait HasSVars {
    fn get_svar(&self, name: &str) -> Option<&str>;
    fn has_svar(&self, name: &str) -> bool {
        self.get_svar(name).is_some()
    }
    fn set_svar(&mut self, name: String, value: String);
    fn set_svars(&mut self, new_svars: HashMap<String, String>);
    fn get_svars(&self) -> &HashMap<String, String>;
    fn remove_svar(&mut self, var: &str);
}
