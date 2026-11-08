# Diagnostic tool only; not a runtime dependency or product image.
# The builder must first verify the frozen base image ID in the oracle script.
FROM retrom-diagnostic-wine:8-debian12
USER root
RUN ["apt-get", "update"]
RUN ["apt-get", "install", "-y", "--no-install-recommends", "libgl1:i386=1.6.0-1", "libgl1-mesa-dri:i386=22.3.6-1+deb12u2", "libglx-mesa0:i386=22.3.6-1+deb12u2"]
USER 1000:1000
