pub trait HasName {
    fn get_name(&self) -> &str;
}

pub trait ITranslatable {
    fn get_translation_key(&self) -> String;
    fn get_untranslated_type(&self) -> String;
    fn get_translated_name(&self) -> String;
}
