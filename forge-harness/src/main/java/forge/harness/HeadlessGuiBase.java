package forge.harness;

import forge.gamemodes.match.HostedMatch;
import forge.gui.download.GuiDownloadService;
import forge.gui.interfaces.IGuiBase;
import forge.gui.interfaces.IGuiGame;
import forge.item.PaperCard;
import forge.localinstance.skin.FSkinProp;
import forge.localinstance.skin.ISkinImage;
import forge.sound.IAudioClip;
import forge.sound.IAudioMusic;
import forge.util.FSerializableFunction;
import forge.util.ImageFetcher;

import org.jupnp.UpnpServiceConfiguration;

import java.io.File;
import java.util.*;
import java.util.function.Consumer;

/**
 * Minimal headless IGuiBase implementation for running Forge without a GUI.
 * Only provides getAssetsDir() — all GUI-related methods are no-ops or return defaults.
 */
public class HeadlessGuiBase implements IGuiBase {
    private final String assetsDir;

    public HeadlessGuiBase(String assetsDir) {
        this.assetsDir = assetsDir.endsWith(File.separator) ? assetsDir : assetsDir + File.separator;
    }

    @Override public boolean isRunningOnDesktop() { return true; }
    @Override public boolean isLibgdxPort() { return false; }
    @Override public String getCurrentVersion() { return "0.0.0-harness"; }
    @Override public String getAssetsDir() { return assetsDir; }
    @Override public ImageFetcher getImageFetcher() { return null; }
    @Override public void invokeInEdtNow(Runnable runnable) { runnable.run(); }
    @Override public void invokeInEdtLater(Runnable runnable) { runnable.run(); }
    @Override public void invokeInEdtAndWait(Runnable proc) { proc.run(); }
    @Override public boolean isGuiThread() { return true; }
    @Override public ISkinImage getSkinIcon(FSkinProp skinProp) { return null; }
    @Override public ISkinImage getUnskinnedIcon(String path) { return null; }
    @Override public ISkinImage getCardArt(PaperCard card) { return null; }
    @Override public ISkinImage getCardArt(PaperCard card, boolean backFace) { return null; }
    @Override public ISkinImage createLayeredImage(PaperCard card, FSkinProp background, String overlayFilename, float opacity) { return null; }
    @Override public void showBugReportDialog(String title, String text, boolean showExitAppBtn) {}
    @Override public void showImageDialog(ISkinImage image, String message, String title) {}
    @Override public int showOptionDialog(String message, String title, FSkinProp icon, List<String> options, int defaultOption) { return 0; }
    @Override public String showInputDialog(String message, String title, FSkinProp icon, String initialInput, List<String> inputOptions, boolean isNumeric) { return ""; }
    @Override public <T> List<T> getChoices(String message, int min, int max, Collection<T> choices, Collection<T> selected, FSerializableFunction<T, String> display) {
        // Return first min choices to avoid blocking
        List<T> result = new ArrayList<>();
        int count = 0;
        for (T choice : choices) {
            if (count >= min) break;
            result.add(choice);
            count++;
        }
        return result;
    }
    @Override public <T> List<T> order(String title, String top, int remainingObjectsMin, int remainingObjectsMax, List<T> sourceChoices, List<T> destChoices) {
        return destChoices != null ? destChoices : new ArrayList<>();
    }
    @Override public String showFileDialog(String title, String defaultDir) { return null; }
    @Override public File getSaveFile(File defaultFile) { return null; }
    @Override public void download(GuiDownloadService service, Consumer<Boolean> callback) { if (callback != null) callback.accept(false); }
    @Override public void refreshSkin() {}
    @Override public void showCardList(String title, String message, List<PaperCard> list) {}
    @Override public boolean showBoxedProduct(String title, String message, List<PaperCard> list) { return false; }
    @Override public PaperCard chooseCard(String title, String message, List<PaperCard> list) { return list != null && !list.isEmpty() ? list.get(0) : null; }
    @Override public int getAvatarCount() { return 0; }
    @Override public int getSleevesCount() { return 0; }
    @Override public void copyToClipboard(String text) {}
    @Override public void browseToUrl(String url) {}
    @Override public boolean isSupportedAudioFormat(File file) { return false; }
    @Override public IAudioClip createAudioClip(String filename) { return null; }
    @Override public IAudioMusic createAudioMusic(String filename) { return null; }
    @Override public void startAltSoundSystem(String filename, boolean isSynchronized) {}
    @Override public void clearImageCache() {}
    @Override public void showSpellShop() {}
    @Override public void showBazaar() {}
    @Override public IGuiGame getNewGuiGame() { return null; }
    @Override public HostedMatch hostMatch() { return null; }
    @Override public void runBackgroundTask(String message, Runnable task) { task.run(); }
    @Override public String encodeSymbols(String str, boolean formatReminderText) { return str; }
    @Override public void preventSystemSleep(boolean preventSleep) {}
    @Override public float getScreenScale() { return 1.0f; }
    @Override public UpnpServiceConfiguration getUpnpPlatformService() { return null; }
    @Override public boolean hasNetGame() { return false; }
}
