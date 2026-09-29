package design.manabrew.xmage;

import java.io.IOException;
import java.io.StringReader;
import javax.swing.text.MutableAttributeSet;
import javax.swing.text.html.HTML;
import javax.swing.text.html.HTMLEditorKit;
import javax.swing.text.html.parser.ParserDelegator;

final class NativeText {
    private NativeText() {}

    static String plain(String html) {
        if (html == null) return "";
        StringBuilder text = new StringBuilder();
        try {
            new ParserDelegator().parse(new StringReader(html), new HTMLEditorKit.ParserCallback() {
                @Override public void handleText(char[] data, int position) { text.append(data); }
                @Override public void handleStartTag(HTML.Tag tag, MutableAttributeSet attributes, int position) {
                    if (tag.isBlock()) text.append(' ');
                }
                @Override public void handleEndTag(HTML.Tag tag, int position) {
                    if (tag.isBlock()) text.append(' ');
                }
                @Override public void handleSimpleTag(HTML.Tag tag, MutableAttributeSet attributes, int position) {
                    if (tag == HTML.Tag.BR) text.append(' ');
                }
            }, true);
        } catch (IOException error) {
            throw new IllegalStateException("Unable to decode native presentation", error);
        }
        return text.toString().replaceAll("\\s+", " ").trim();
    }
}
