package mage.remote;

import java.lang.reflect.Field;
import mage.interfaces.MageClient;
import org.jboss.remoting.callback.Callback;

public final class SerializedSession extends SessionImpl {
    public SerializedSession(MageClient client) {
        super(client);
    }

    @Override
    public synchronized boolean connectStart(Connection connection) {
        try {
            Field handler = SessionImpl.class.getDeclaredField("callbackHandler");
            handler.setAccessible(true);
            handler.set(this, new SerialHandler());
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Unsupported XMage callback implementation", error);
        }
        return super.connectStart(connection);
    }

    private final class SerialHandler extends CallbackHandler {
        @Override
        public synchronized void handleCallback(Callback callback) {
            super.handleCallback(callback);
        }
    }
}
