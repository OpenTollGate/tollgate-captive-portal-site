PKG_MAKEFILE_DIR:=$(dir $(abspath $(lastword $(MAKEFILE_LIST))))

include $(TOPDIR)/rules.mk

# NOTE: tollgate-wrt and luci are runtime dependencies but not listed in
# DEPENDS because they are not in opkg/apk feeds yet. The SDK compile would
# fail trying to resolve them. Install with:
#   opkg install tollgate-captive-portal && opkg install --force-depends tollgate-captive-portal
# Once tollgate-wrt is published to feeds, add +tollgate-wrt +luci back to DEPENDS.
PKG_NAME:=tollgate-captive-portal
TOLLGATE_DISPLAY_VERSION:=$(if $(strip $(PACKAGE_VERSION)),$(PACKAGE_VERSION),0.0.0)

ifeq ($(CONFIG_USE_APK),y)
PKG_VERSION:=$(shell sh "$(PKG_MAKEFILE_DIR)normalize-apk-version.sh" "$(TOLLGATE_DISPLAY_VERSION)")
else
PKG_VERSION:=$(TOLLGATE_DISPLAY_VERSION)
endif

PKG_FLAGS:=overwrite

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

PKG_MAINTAINER:=TollGate <tollgate@tollgate.me>
PKG_LICENSE:=MIT

PKG_BUILD_PARALLEL:=1

include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)
	SECTION:=net
	CATEGORY:=Network
	TITLE:=TollGate Captive Portal and Admin SPA
	DEPENDS:=+nodogsplash +jq
	PROVIDES:=tollgate-captive-portal-site
	CONFLICTS:=configurationwizzard
	REPLACES:=tollgate-wrt
endef

define Package/$(PKG_NAME)/description
	TollGate captive portal and admin dashboard SPA.
	Replaces the default captive portal with a React-based
	portal supporting Cashu and Lightning payments.
	Includes an admin dashboard with schema-driven settings,
	wallet management, and WiFi configuration.
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh

echo "Running post-installation for tollgate-captive-portal..."

for script in /etc/uci-defaults/91-tollgate-portal-setup; do
    if [ -x "$$script" ]; then
        echo "Running $$script ..."
        "$$script" || echo "Warning: $$script exited with code $$?"
    fi
done

echo "Restarting rpcd..."
/etc/init.d/rpcd restart

echo "Restarting uhttpd..."
/etc/init.d/uhttpd restart

echo "Restarting NoDogSplash..."
/etc/init.d/nodogsplash restart 2>/dev/null || true

echo "Post-installation completed"
exit 0
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh

echo "Running pre-removal for tollgate-captive-portal..."

echo "Restarting rpcd..."
/etc/init.d/rpcd restart

echo "Restarting uhttpd..."
/etc/init.d/uhttpd restart

echo "Restarting NoDogSplash..."
/etc/init.d/nodogsplash restart 2>/dev/null || true

echo "Pre-removal completed"
exit 0
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/etc/tollgate/tollgate-captive-portal-site
	$(CP) $(PKG_MAKEFILE_DIR)dist/portal/* $(1)/etc/tollgate/tollgate-captive-portal-site/

	$(INSTALL_DIR) $(1)/www/tollgate
	$(CP) $(PKG_MAKEFILE_DIR)dist/admin/* $(1)/www/tollgate/

	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) $(PKG_MAKEFILE_DIR)openwrt/rpcd/tollgate $(1)/usr/libexec/rpcd/

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) $(PKG_MAKEFILE_DIR)openwrt/rpcd/tollgate_acl.json $(1)/usr/share/rpcd/acl.d/tollgate.json

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_DATA) $(PKG_MAKEFILE_DIR)openwrt/files/etc/config/uhttpd_tollgate $(1)/etc/config/

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) $(PKG_MAKEFILE_DIR)packaging/files/etc/uci-defaults/91-tollgate-portal-setup $(1)/etc/uci-defaults/
endef

FILES_$(PKG_NAME) += \
	/etc/tollgate/tollgate-captive-portal-site/* \
	/www/tollgate/* \
	/usr/libexec/rpcd/tollgate \
	/usr/share/rpcd/acl.d/tollgate.json \
	/etc/config/uhttpd_tollgate \
	/etc/uci-defaults/91-tollgate-portal-setup

$(eval $(call BuildPackage,$(PKG_NAME)))
